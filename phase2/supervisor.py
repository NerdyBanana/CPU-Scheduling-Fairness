"""HNWF fairness supervisor applied over a selected Phase 1 base policy."""

from __future__ import annotations

from collections import deque
from typing import Optional

import pandas as pd

from .config import HNWFConfig
from .hnwf import _append_slice, _build_states, _process_results, _runnable, _snapshot
from .metrics import compute_phase2_metrics
from .models import HNWFResult, ProcessState
from .risk_model import RiskPredictor, feature_vector, workload_statistics


BASE_ALGORITHMS = ("FCFS", "SJF", "SRTF", "RR", "Priority")


def _base_choice(algorithm: str, ready: list[ProcessState], rr_queue: deque[str]) -> ProcessState:
    if algorithm == "FCFS":
        return min(ready, key=lambda p: (p.arrival, p.pid))
    if algorithm == "SJF":
        return min(ready, key=lambda p: (p.burst, p.arrival, p.pid))
    if algorithm == "SRTF":
        return min(ready, key=lambda p: (p.remaining, p.arrival, p.pid))
    if algorithm == "Priority":
        return min(ready, key=lambda p: (p.priority, p.arrival, p.pid))
    ready_ids = {process.pid for process in ready}
    while rr_queue and rr_queue[0] not in ready_ids:
        rr_queue.popleft()
    if not rr_queue:
        for process in sorted(ready, key=lambda p: (p.arrival, p.pid)):
            rr_queue.append(process.pid)
    pid = rr_queue[0]
    return next(process for process in ready if process.pid == pid)


def run_supervised(
    df: pd.DataFrame,
    base_algorithm: str,
    config: Optional[HNWFConfig] = None,
    predictor: Optional[RiskPredictor] = None,
    quantum: int = 2,
) -> HNWFResult:
    """Run a Phase 1 policy with HNWF monitoring and bounded intervention."""
    if base_algorithm not in BASE_ALGORITHMS:
        raise ValueError(f"unsupported HNWF base policy: {base_algorithm}")
    if quantum < 1:
        raise ValueError("quantum must be at least 1")
    config = config or HNWFConfig()
    predictor = predictor or RiskPredictor.load()
    states = _build_states(df.copy())
    stats = workload_statistics(states)
    time = min(process.arrival for process in states)
    completed = 0
    decision_id = 0
    slices: list[dict] = []
    fairness_trace: list[dict] = []
    guard_events: list[dict] = []
    rr_queue: deque[str] = deque()
    rr_seen: set[str] = set()
    running: Optional[ProcessState] = None
    run_budget = 0
    running_reason = "BASE_POLICY"
    running_decision_id = 0
    previous_pid: Optional[str] = None
    context_switches = 0
    ml_cooldown_until = 0

    total_burst = sum(process.burst for process in states)
    safety_limit = max(process.arrival for process in states) + total_burst * 30 + 10_000

    while completed < len(states):
        if time > safety_limit:
            raise RuntimeError("HNWF supervisor safety limit exceeded")

        ready = _runnable(states, time)
        if not ready:
            time = min(process.arrival for process in states if not process.completed and process.arrival > time)
            running = None
            previous_pid = None
            continue

        for process in sorted(ready, key=lambda p: (p.arrival, p.pid)):
            process.max_service_gap = max(process.max_service_gap, process.service_gap(time))
            if base_algorithm == "RR" and process.pid not in rr_seen:
                rr_queue.append(process.pid)
                rr_seen.add(process.pid)

        nonpreemptive_locked = base_algorithm in {"FCFS", "SJF", "Priority"} and running is not None and not running.completed
        rr_locked = base_algorithm == "RR" and running is not None and not running.completed and run_budget > 0
        if nonpreemptive_locked or rr_locked:
            selected = running
            reason = running_reason
            current_decision_id = running_decision_id
            predictions = {}
            base = selected
        else:
            if base_algorithm == "RR" and running is not None:
                if rr_queue and rr_queue[0] == running.pid:
                    rr_queue.popleft()
                if not running.completed:
                    rr_queue.append(running.pid)
            base = _base_choice(base_algorithm, ready, rr_queue)
            predictions = {}
            for process in ready:
                vector = feature_vector(process, ready, states, time, base_algorithm, base.pid, stats)
                predictions[process.pid] = predictor.predict(vector)

            guarded = [process for process in ready if process.service_gap(time) >= config.gmax]
            prediction_horizon = int(predictor.metadata.get("label_horizon_ms", 16))
            early_warning_gap = max(0, config.gmax - prediction_horizon)
            starvation_risk = [
                process for process in ready
                if time >= ml_cooldown_until
                and process.service_gap(time) >= early_warning_gap
                and predictions[process.pid].starvation_probability >= predictor.starvation.threshold
            ]
            unfairness_risk = [
                process for process in ready
                if time >= ml_cooldown_until
                and predictions[process.pid].unfairness_probability >= predictor.unfairness.threshold
                and process.fairness_debt > config.debt_epsilon
            ]
            if guarded:
                selected = min(guarded, key=lambda p: (-p.service_gap(time), p.arrival, p.pid))
                reason = "HARD_GUARD"
            elif starvation_risk:
                selected = min(starvation_risk, key=lambda p: (-predictions[p.pid].starvation_probability, -p.service_gap(time), p.arrival, p.pid))
                reason = "ML_STARVATION_RISK"
            elif unfairness_risk:
                selected = min(unfairness_risk, key=lambda p: (-predictions[p.pid].unfairness_probability, -p.fairness_debt, p.arrival, p.pid))
                reason = "ML_UNFAIRNESS_RISK"
            else:
                selected = base
                reason = "BASE_POLICY"
            # A high-risk score on the process already proposed by the base
            # policy is useful telemetry, not an override.
            if selected.pid == base.pid:
                reason = "BASE_POLICY"
            elif reason in {"ML_STARVATION_RISK", "ML_UNFAIRNESS_RISK"}:
                # One short recovery slice per boost interval keeps ML as a
                # supervisor instead of allowing it to replace the base policy.
                ml_cooldown_until = time + config.boost_interval

            decision_id += 1
            current_decision_id = decision_id
            if base_algorithm in {"FCFS", "SJF", "Priority"}:
                run_budget = selected.remaining
            elif base_algorithm == "RR" and reason == "BASE_POLICY":
                run_budget = min(quantum, selected.remaining)
            else:
                run_budget = min(config.protected_quantum, selected.remaining) if reason != "BASE_POLICY" else 1
            running = selected
            running_reason = reason
            running_decision_id = current_decision_id

            if reason == "HARD_GUARD":
                selected.guard_activations += 1
                guard_events.append({
                    "decision_id": current_decision_id,
                    "pid": selected.pid,
                    "trigger_time": time,
                    "observed_gap": selected.service_gap(time),
                    "gmax": config.gmax,
                    "service_start": time,
                    "service_end": time + run_budget,
                    "protected_service": run_budget,
                    "completed_during_guard": selected.remaining <= run_budget,
                    "resolved": True,
                })

            candidates = []
            for process in ready:
                candidate = _snapshot(process, time, config)
                prediction = predictions[process.pid]
                candidate.update({
                    "starvation_probability": round(prediction.starvation_probability, 6),
                    "unfairness_probability": round(prediction.unfairness_probability, 6),
                    "base_selected": process.pid == base.pid,
                })
                candidates.append(candidate)
            fairness_trace.append({
                "decision_id": current_decision_id,
                "time": time,
                "base_algorithm": base_algorithm,
                "base_proposed_pid": base.pid,
                "selected_pid": selected.pid,
                "overridden": selected.pid != base.pid,
                "reason": reason,
                "protected_until": time + run_budget if reason != "BASE_POLICY" else None,
                "total_ready_weight": sum(process.weight for process in ready),
                "runnable_pids": [process.pid for process in ready],
                "candidates": candidates,
            })

        switching = previous_pid is not None and previous_pid != selected.pid
        if switching:
            previous = next(process for process in states if process.pid == previous_pid)
            if not previous.completed:
                previous.preemptions += 1
            context_switches += 1

        total_weight = sum(process.weight for process in ready)
        for process in ready:
            process.ideal_service += process.weight / total_weight
        if selected.first_run is None:
            selected.first_run = time
        selected.actual_service += 1.0
        selected.remaining -= 1
        selected.vruntime += 1024.0 / selected.weight
        for process in ready:
            process.fairness_debt = process.ideal_service - process.actual_service
            process.max_positive_debt = max(process.max_positive_debt, process.fairness_debt)

        protected = reason != "BASE_POLICY"
        _append_slice(slices, current_decision_id, selected, time, reason, protected, switching)
        time += 1
        selected.last_service_end = time
        previous_pid = selected.pid
        run_budget -= 1
        if selected.completed:
            selected.completion = time
            completed += 1
            if base_algorithm == "RR":
                try:
                    rr_queue.remove(selected.pid)
                except ValueError:
                    pass
            running = None
            run_budget = 0
        elif run_budget == 0:
            running = None

    metrics = compute_phase2_metrics(states, slices, config, context_switches, 0)
    metrics.update({
        "fairness_overrides": sum(decision["overridden"] for decision in fairness_trace),
        "ml_starvation_interventions": sum(decision["reason"] == "ML_STARVATION_RISK" for decision in fairness_trace),
        "ml_unfairness_interventions": sum(decision["reason"] == "ML_UNFAIRNESS_RISK" for decision in fairness_trace),
    })
    configuration = config.to_dict()
    configuration.update({
        "policy": f"{base_algorithm}+HNWF",
        "role": "fairness_supervisor",
        "base_algorithm": base_algorithm,
        "risk_model": "dual_logistic_regression",
        "starvation_threshold": predictor.starvation.threshold,
        "unfairness_threshold": predictor.unfairness.threshold,
        "model_metadata": predictor.metadata,
    })
    return HNWFResult(
        metrics=metrics,
        processes=_process_results(states),
        slices=slices,
        fairness_trace=fairness_trace,
        guard_events=guard_events,
        configuration=configuration,
        invariant_totals={
            "burst": sum(process.burst for process in states),
            "actual_service": round(sum(process.actual_service for process in states), 6),
            "ideal_service": round(sum(process.ideal_service for process in states), 6),
        },
    )

