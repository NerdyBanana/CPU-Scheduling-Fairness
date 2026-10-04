"""Reference implementation of Hybrid Nice-Weighted Fairness (HNWF)."""

from __future__ import annotations

from typing import Optional

import pandas as pd

from .config import HNWFConfig
from .metrics import compute_phase2_metrics
from .models import HNWFResult, ProcessState
from .nice_weights import nice_from_priority, weight_from_priority


REQUIRED_COLUMNS = ("PID", "Arrival_Time", "Burst_Time", "Priority")


def _integer(value, field: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be an integer")
    try:
        converted = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be an integer") from exc
    try:
        if float(value) != converted:
            raise ValueError(f"{field} must be an integer")
    except (TypeError, ValueError):
        if str(value).strip() != str(converted):
            raise ValueError(f"{field} must be an integer")
    return converted


def _build_states(df: pd.DataFrame) -> list[ProcessState]:
    missing = [name for name in REQUIRED_COLUMNS if name not in df.columns]
    if missing:
        raise ValueError(f"missing required columns: {', '.join(missing)}")
    if df.empty:
        raise ValueError("at least one process is required")

    rows: list[ProcessState] = []
    seen: set[str] = set()
    for _, row in df.iterrows():
        pid = str(row["PID"]).strip()
        if not pid:
            raise ValueError("PID cannot be empty")
        if pid in seen:
            raise ValueError(f"duplicate PID: {pid}")
        seen.add(pid)

        arrival = _integer(row["Arrival_Time"], "Arrival_Time")
        burst = _integer(row["Burst_Time"], "Burst_Time")
        priority = _integer(row["Priority"], "Priority")
        if arrival < 0:
            raise ValueError("Arrival_Time cannot be negative")
        if burst <= 0:
            raise ValueError("Burst_Time must be positive")
        nice = nice_from_priority(priority)
        rows.append(
            ProcessState(
                pid=pid,
                arrival=arrival,
                burst=burst,
                priority=priority,
                nice=nice,
                weight=weight_from_priority(priority),
                remaining=burst,
            )
        )
    return sorted(rows, key=lambda p: (p.arrival, p.pid))


def _runnable(states: list[ProcessState], time: int) -> list[ProcessState]:
    return [p for p in states if p.arrival <= time and not p.completed]


def _snapshot(process: ProcessState, time: int, config: HNWFConfig) -> dict:
    gap = process.service_gap(time)
    return {
        "pid": process.pid,
        "remaining": process.remaining,
        "nice": process.nice,
        "weight": process.weight,
        "ideal_service": round(process.ideal_service, 6),
        "actual_service": round(process.actual_service, 6),
        "fairness_debt": round(process.fairness_debt, 6),
        "vruntime": round(process.vruntime, 6),
        "service_gap": gap,
        "boost": process.boost(time, config.boost_interval, config.max_boost),
        "guard_eligible": gap >= config.gmax,
    }


def _choose(
    runnable: list[ProcessState], time: int, config: HNWFConfig
) -> tuple[ProcessState, str]:
    guarded = [p for p in runnable if p.service_gap(time) >= config.gmax]
    if guarded:
        return min(guarded, key=lambda p: (-p.service_gap(time), p.arrival, p.pid)), "HARD_GUARD"

    max_debt = max(p.fairness_debt for p in runnable)
    if max_debt > config.debt_epsilon:
        tied = [p for p in runnable if max_debt - p.fairness_debt <= config.debt_epsilon]
        return min(
            tied,
            key=lambda p: (
                -p.boost(time, config.boost_interval, config.max_boost),
                p.remaining,
                p.arrival,
                p.pid,
            ),
        ), "FAIRNESS_DEBT"

    max_boost = max(p.boost(time, config.boost_interval, config.max_boost) for p in runnable)
    if max_boost > 0:
        boosted = [
            p
            for p in runnable
            if p.boost(time, config.boost_interval, config.max_boost) == max_boost
        ]
        return min(boosted, key=lambda p: (p.remaining, p.arrival, p.pid)), "TEMPORARY_BOOST"

    return min(runnable, key=lambda p: (p.remaining, p.arrival, p.pid)), "SRTF_FALLBACK"


def _append_slice(
    slices: list[dict],
    decision_id: int,
    process: ProcessState,
    start: int,
    reason: str,
    protected: bool,
    context_switch_before: bool,
) -> None:
    if (
        slices
        and slices[-1]["pid"] == process.pid
        and slices[-1]["reason"] == reason
        and slices[-1]["protected"] == protected
        and slices[-1]["end"] == start
        and not context_switch_before
    ):
        slices[-1]["end"] = start + 1
        slices[-1]["duration"] += 1
        return
    slices.append(
        {
            "decision_id": decision_id,
            "pid": process.pid,
            "start": start,
            "end": start + 1,
            "duration": 1,
            "reason": reason,
            "protected": protected,
            "context_switch_before": context_switch_before,
        }
    )


def _process_results(states: list[ProcessState]) -> list[dict]:
    results = []
    for p in sorted(states, key=lambda item: item.pid):
        turnaround = p.completion - p.arrival
        waiting = turnaround - p.burst
        response = p.first_run - p.arrival
        results.append(
            {
                "pid": p.pid,
                "arrival": p.arrival,
                "burst": p.burst,
                "priority": p.priority,
                "nice": p.nice,
                "weight": p.weight,
                "start": p.first_run,
                "completion": p.completion,
                "waiting": waiting,
                "turnaround": turnaround,
                "response": response,
                "slowdown": round(turnaround / p.burst, 6),
                "actual_service": round(p.actual_service, 6),
                "ideal_service": round(p.ideal_service, 6),
                "final_fairness_debt": round(p.fairness_debt, 6),
                "max_positive_debt": round(p.max_positive_debt, 6),
                "final_vruntime": round(p.vruntime, 6),
                "max_service_gap": p.max_service_gap,
                "preemptions": p.preemptions,
                "guard_activations": p.guard_activations,
                "state": "COMPLETED",
            }
        )
    return results


def run_hnwf(df: pd.DataFrame, config: Optional[HNWFConfig] = None) -> HNWFResult:
    """Run one deterministic HNWF schedule and return its full audit record."""
    config = config or HNWFConfig()
    states = _build_states(df.copy())
    time = min(p.arrival for p in states)
    completed = 0
    decision_id = 0
    fairness_trace: list[dict] = []
    guard_events: list[dict] = []
    slices: list[dict] = []

    previous_pid: Optional[str] = None
    locked: Optional[ProcessState] = None
    lock_remaining = 0
    lock_decision_id = 0
    context_switches = 0
    context_switch_overhead = 0
    switch_already_paid = False

    total_burst = sum(p.burst for p in states)
    safety_limit = max(p.arrival for p in states) + total_burst * 20 + 10_000

    while completed < len(states):
        if time > safety_limit:
            raise RuntimeError("HNWF safety limit exceeded")

        ready = _runnable(states, time)
        if not ready:
            next_arrival = min(p.arrival for p in states if not p.completed and p.arrival > time)
            decision_id += 1
            fairness_trace.append(
                {
                    "decision_id": decision_id,
                    "time": time,
                    "selected_pid": None,
                    "reason": "IDLE_JUMP",
                    "protected_until": None,
                    "total_ready_weight": 0,
                    "runnable_pids": [],
                    "candidates": [],
                    "jump_to": next_arrival,
                }
            )
            time = next_arrival
            previous_pid = None
            switch_already_paid = False
            continue

        # Observe every runnable process before selecting one. The selected
        # process may be the one that has just reached Gmax, so recording zero
        # for it after dispatch would hide the wait that triggered the guard.
        for p in ready:
            p.max_service_gap = max(p.max_service_gap, p.service_gap(time))

        # Seed new arrivals at the current minimum virtual runtime.
        current_min_vruntime = min((p.vruntime for p in ready if p.actual_service > 0), default=0.0)
        for p in ready:
            if p.actual_service == 0 and p.ideal_service == 0:
                p.vruntime = current_min_vruntime

        if locked is not None and not locked.completed and lock_remaining > 0:
            selected = locked
            reason = "HARD_GUARD"
            current_decision_id = lock_decision_id
            protected = True
        else:
            locked = None
            lock_remaining = 0
            selected, reason = _choose(ready, time, config)
            decision_id += 1
            current_decision_id = decision_id
            protected = reason == "HARD_GUARD"
            protected_until = None
            if protected:
                run_length = min(config.protected_quantum, selected.remaining)
                locked = selected
                lock_remaining = run_length
                lock_decision_id = current_decision_id
                protected_until = time + run_length
                selected.guard_activations += 1
                guard_events.append(
                    {
                        "decision_id": current_decision_id,
                        "pid": selected.pid,
                        "trigger_time": time,
                        "observed_gap": selected.service_gap(time),
                        "gmax": config.gmax,
                        "service_start": time,
                        "service_end": time + run_length,
                        "protected_service": run_length,
                        "completed_during_guard": selected.remaining <= config.protected_quantum,
                        "resolved": True,
                    }
                )
            fairness_trace.append(
                {
                    "decision_id": current_decision_id,
                    "time": time,
                    "selected_pid": selected.pid,
                    "reason": reason,
                    "protected_until": protected_until,
                    "total_ready_weight": sum(p.weight for p in ready),
                    "runnable_pids": [p.pid for p in ready],
                    "candidates": [_snapshot(p, time, config) for p in ready],
                }
            )

        switching = previous_pid is not None and previous_pid != selected.pid
        if switching and not switch_already_paid:
            previous = next(p for p in states if p.pid == previous_pid)
            if not previous.completed:
                previous.preemptions += 1
            context_switches += 1
            if config.context_switch_cost:
                time += config.context_switch_cost
                context_switch_overhead += config.context_switch_cost
                previous_pid = None
                switch_already_paid = True
                continue
        context_switch_before = switching or switch_already_paid
        switch_already_paid = False

        # Re-evaluate the runnable set at the actual execution instant.
        ready = _runnable(states, time)
        if selected not in ready:
            locked = None
            lock_remaining = 0
            continue
        total_weight = sum(p.weight for p in ready)
        for p in ready:
            p.max_service_gap = max(p.max_service_gap, p.service_gap(time))
            p.ideal_service += p.weight / total_weight

        if selected.first_run is None:
            selected.first_run = time
        selected.actual_service += 1.0
        selected.remaining -= 1
        selected.vruntime += 1024.0 / selected.weight
        for p in ready:
            p.fairness_debt = p.ideal_service - p.actual_service
            p.max_positive_debt = max(p.max_positive_debt, p.fairness_debt)

        _append_slice(
            slices,
            current_decision_id,
            selected,
            time,
            reason,
            protected,
            context_switch_before,
        )
        time += 1
        selected.last_service_end = time
        previous_pid = selected.pid

        if protected:
            lock_remaining -= 1
            if lock_remaining == 0:
                locked = None
        if selected.completed:
            selected.completion = time
            completed += 1
            if locked is selected:
                locked = None
                lock_remaining = 0

    metrics = compute_phase2_metrics(
        states,
        slices,
        config,
        context_switches=context_switches,
        context_switch_overhead=context_switch_overhead,
    )
    process_results = _process_results(states)
    return HNWFResult(
        metrics=metrics,
        processes=process_results,
        slices=slices,
        fairness_trace=fairness_trace,
        guard_events=guard_events,
        configuration=config.to_dict(),
        invariant_totals={
            "burst": sum(p.burst for p in states),
            "actual_service": round(sum(p.actual_service for p in states), 6),
            "ideal_service": round(sum(p.ideal_service for p in states), 6),
        },
    )
