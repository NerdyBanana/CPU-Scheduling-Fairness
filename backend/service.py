"""Framework-independent simulation service used by the FastAPI adapter."""

from __future__ import annotations

from collections import Counter, deque
from pathlib import Path
from statistics import mean, pstdev
from typing import Any, Iterable

import pandas as pd

from phase1_only.dataset_gen import generate_workload
from phase1_only.metrics import compute_metrics as compute_phase1_metrics
from phase1_only.schedulers.fcfs import run_fcfs
from phase1_only.schedulers.priority import run_priority
from phase1_only.schedulers.round_robin import run_round_robin
from phase1_only.schedulers.sjf_srtf import run_sjf, run_srtf
from phase2 import HNWFConfig
from phase2.supervisor import BASE_ALGORITHMS, run_supervised


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
FAIRNESS_VARIANTS = tuple(f"{name}+HNWF" for name in BASE_ALGORITHMS)
# ``HNWF`` remains as a compatibility alias for ``SRTF+HNWF`` while the
# frontend migrates from the old sixth-scheduler contract.
ALGORITHMS = (*BASE_ALGORITHMS, *FAIRNESS_VARIANTS, "HNWF")
WORKLOADS = ("normal", "skewed", "bursty")


class SimulationError(ValueError):
    def __init__(self, code: str, message: str, field: str | None = None, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.field = field
        self.status_code = status_code

    def detail(self) -> dict:
        payload = {"code": self.code, "message": self.message}
        if self.field is not None:
            payload["field"] = self.field
        return payload


def normalize_algorithm(name: str) -> str:
    aliases = {
        "fcfs": "FCFS", "sjf": "SJF", "srtf": "SRTF",
        "rr": "RR", "round robin": "RR", "priority": "Priority", "hnwf": "HNWF",
        "fcfs+hnwf": "FCFS+HNWF", "sjf+hnwf": "SJF+HNWF",
        "srtf+hnwf": "SRTF+HNWF", "rr+hnwf": "RR+HNWF",
        "round robin+hnwf": "RR+HNWF", "priority+hnwf": "Priority+HNWF",
    }
    normalized = aliases.get(str(name).strip().lower())
    if normalized is None:
        raise SimulationError("UNSUPPORTED_ALGORITHM", f"Unsupported algorithm: {name}", "algorithms")
    return normalized


def validate_processes(frame: pd.DataFrame) -> pd.DataFrame:
    required = ["PID", "Arrival_Time", "Burst_Time", "Priority"]
    if any(column not in frame for column in required):
        raise SimulationError("INVALID_PROCESS_SCHEMA", f"Required columns: {required}", "custom_processes")
    frame = frame[required].copy()
    if frame.empty:
        raise SimulationError("INVALID_PROCESS_SCHEMA", "At least one process is required.", "custom_processes")
    frame["PID"] = frame["PID"].astype(str).str.strip()
    if (frame["PID"] == "").any():
        raise SimulationError("INVALID_PID", "PID cannot be empty.", "custom_processes.pid")
    if frame["PID"].duplicated().any():
        raise SimulationError("DUPLICATE_PID", "Each process PID must be unique.", "custom_processes.pid")
    for column, code in (("Arrival_Time", "INVALID_ARRIVAL"), ("Burst_Time", "INVALID_BURST"), ("Priority", "INVALID_PRIORITY")):
        numeric = pd.to_numeric(frame[column], errors="coerce")
        if numeric.isna().any() or (numeric % 1 != 0).any():
            raise SimulationError(code, f"{column} must contain integers.", f"custom_processes.{column}")
        frame[column] = numeric.astype(int)
    if (frame["Arrival_Time"] < 0).any():
        raise SimulationError("INVALID_ARRIVAL", "Arrival must be nonnegative.", "custom_processes.arrival")
    if (frame["Burst_Time"] <= 0).any():
        raise SimulationError("INVALID_BURST", "Burst must be positive.", "custom_processes.burst")
    if ((frame["Priority"] < 1) | (frame["Priority"] > 9)).any():
        raise SimulationError("INVALID_PRIORITY", "Priority must be between 1 and 9.", "custom_processes.priority")
    return frame


def frame_from_custom(processes: Iterable[Any]) -> pd.DataFrame:
    rows = []
    for process in processes:
        if hasattr(process, "model_dump"):
            process = process.model_dump()
        elif hasattr(process, "dict"):
            process = process.dict()
        rows.append({"PID": process["pid"], "Arrival_Time": process["arrival"], "Burst_Time": process["burst"], "Priority": process["priority"]})
    return validate_processes(pd.DataFrame(rows))


def load_workload(workload: str, seed: int, n: int = 25) -> pd.DataFrame:
    if workload not in WORKLOADS:
        raise SimulationError("WORKLOAD_NOT_FOUND", f"Unknown workload: {workload}", "workload", 404)
    if not 0 <= seed <= 9:
        raise SimulationError("INVALID_SEED", "Seed must be between 0 and 9.", "seed")
    path = DATA_DIR / f"{workload}_seed{seed}.csv"
    frame = pd.read_csv(path) if path.exists() and n == 25 else generate_workload(n=n, seed=seed, kind=workload)
    return validate_processes(frame)


def _nonpreemptive_slices(schedule: pd.DataFrame) -> list[tuple[str, int, int]]:
    return [(str(row.PID), int(row.Start_Time), int(row.Completion_Time)) for row in schedule.itertuples()]


def _srtf_slices(frame: pd.DataFrame) -> list[tuple[str, int, int]]:
    processes = frame.reset_index(drop=True)
    remaining = processes["Burst_Time"].astype(int).tolist()
    arrivals = processes["Arrival_Time"].astype(int).tolist()
    time = min(arrivals)
    completed = 0
    slices: list[tuple[str, int, int]] = []
    current_pid = None
    start = time
    while completed < len(processes):
        candidates = [i for i in range(len(processes)) if arrivals[i] <= time and remaining[i] > 0]
        if not candidates:
            if current_pid is not None:
                slices.append((current_pid, start, time)); current_pid = None
            time = min(arrivals[i] for i in range(len(processes)) if remaining[i] > 0)
            start = time
            continue
        i = min(candidates, key=lambda j: (remaining[j], arrivals[j], str(processes.loc[j, "PID"])))
        pid = str(processes.loc[i, "PID"])
        if pid != current_pid:
            if current_pid is not None:
                slices.append((current_pid, start, time))
            current_pid, start = pid, time
        remaining[i] -= 1
        time += 1
        if remaining[i] == 0:
            completed += 1
    if current_pid is not None:
        slices.append((current_pid, start, time))
    return slices


def _rr_slices(frame: pd.DataFrame, quantum: int) -> list[tuple[str, int, int]]:
    processes = frame.reset_index(drop=True)
    remaining = processes["Burst_Time"].astype(int).tolist()
    arrivals = processes["Arrival_Time"].astype(int).tolist()
    order = sorted(range(len(processes)), key=lambda i: (arrivals[i], str(processes.loc[i, "PID"])))
    time, pointer, completed = arrivals[order[0]], 0, 0
    queue: deque[int] = deque()
    slices = []
    while pointer < len(order) and arrivals[order[pointer]] <= time:
        queue.append(order[pointer]); pointer += 1
    while completed < len(processes):
        if not queue:
            time = arrivals[order[pointer]]
            while pointer < len(order) and arrivals[order[pointer]] <= time:
                queue.append(order[pointer]); pointer += 1
            continue
        i = queue.popleft()
        duration = min(quantum, remaining[i])
        slices.append((str(processes.loc[i, "PID"]), time, time + duration))
        time += duration
        remaining[i] -= duration
        while pointer < len(order) and arrivals[order[pointer]] <= time:
            queue.append(order[pointer]); pointer += 1
        if remaining[i] > 0:
            queue.append(i)
        else:
            completed += 1
    return slices


def _baseline_result(algorithm: str, frame: pd.DataFrame, quantum: int) -> dict:
    if algorithm == "FCFS":
        schedule = run_fcfs(frame.copy()); raw_slices = _nonpreemptive_slices(schedule)
    elif algorithm == "SJF":
        schedule = run_sjf(frame.copy()); raw_slices = _nonpreemptive_slices(schedule)
    elif algorithm == "SRTF":
        schedule = run_srtf(frame.copy()); raw_slices = _srtf_slices(frame)
    elif algorithm == "RR":
        schedule = run_round_robin(frame.copy(), quantum=quantum); raw_slices = _rr_slices(frame, quantum)
    elif algorithm == "Priority":
        schedule = run_priority(frame.copy()); raw_slices = _nonpreemptive_slices(schedule)
    else:
        raise SimulationError("UNSUPPORTED_ALGORITHM", f"Unsupported baseline: {algorithm}", "algorithms")

    raw = compute_phase1_metrics(schedule)
    waiting = schedule["Waiting_Time"].astype(float)
    turnaround = schedule["Turnaround_Time"].astype(float)
    slowdown = turnaround / schedule["Burst_Time"].astype(float)
    counts = Counter(pid for pid, _, _ in raw_slices)
    context_switches = sum(raw_slices[i - 1][0] != raw_slices[i][0] for i in range(1, len(raw_slices)))
    metrics = {
        "avg_waiting_time": round(float(raw["Avg_Waiting_Time"]), 4), "avg_turnaround_time": round(float(raw["Avg_Turnaround_Time"]), 4),
        "avg_response_time": round(float(raw["Avg_Response_Time"]), 4), "max_waiting_time": round(float(raw["Max_Waiting_Time"]), 4),
        "p95_waiting_time": round(float(waiting.quantile(0.95)), 4),
        "waiting_time_stddev": round(float(waiting.std(ddof=1) if len(waiting) > 1 else 0.0), 4),
        "throughput": round(float(raw["Throughput"]), 6), "cpu_utilization": round(float(raw["CPU_Utilization"]), 4),
        "legacy_jains_waiting_index": round(float(raw["Jains_Fairness_Index"]), 4), "legacy_starvation_count": int(raw["Starvation_Count"]),
        "legacy_starvation_threshold": round(2 * float(raw["Avg_Waiting_Time"]), 4),
        "max_slowdown": round(float(slowdown.max()), 4), "p95_slowdown": round(float(slowdown.quantile(0.95)), 4),
        "preemptions": int(sum(max(0, count - 1) for count in counts.values())), "context_switches": int(context_switches), "context_switch_overhead": 0,
    }
    threshold = metrics["legacy_starvation_threshold"]
    processes = [{
        "pid": str(row.PID), "arrival": int(row.Arrival_Time), "burst": int(row.Burst_Time), "priority": int(row.Priority),
        "start": int(row.Start_Time), "completion": int(row.Completion_Time), "waiting": int(row.Waiting_Time),
        "turnaround": int(row.Turnaround_Time), "response": int(row.Response_Time),
        "slowdown": round(float(row.Turnaround_Time / row.Burst_Time), 4), "starved": bool(row.Waiting_Time > threshold), "state": "COMPLETED",
    } for row in schedule.itertuples()]
    slices = [{
        "decision_id": i, "pid": pid, "start": start, "end": end, "duration": end - start, "reason": algorithm,
        "protected": False, "context_switch_before": i > 1 and raw_slices[i - 2][0] != pid,
    } for i, (pid, start, end) in enumerate(raw_slices, start=1)]
    return {"metrics": metrics, "processes": processes, "slices": slices, "fairness_trace": [], "guard_events": [], "configuration": {"policy": algorithm, **({"quantum": quantum} if algorithm == "RR" else {})}}


def run_algorithm(algorithm: str, frame: pd.DataFrame, quantum: int, config: HNWFConfig) -> dict:
    if algorithm in BASE_ALGORITHMS:
        return _baseline_result(algorithm, frame, quantum)
    base_algorithm = "SRTF" if algorithm == "HNWF" else algorithm.removesuffix("+HNWF")
    result = run_supervised(frame.copy(), base_algorithm, config, quantum=quantum).to_dict()
    if algorithm == "HNWF":
        result["configuration"].update({
            "policy": "SRTF+HNWF",
            "compatibility_alias": "HNWF",
            "deprecation_note": "HNWF is a fairness supervisor; request SRTF+HNWF explicitly.",
        })
    return result


def _aggregate_algorithm(results: list[dict]) -> dict:
    metric_names = sorted(set.intersection(*(set(result["metrics"]) for result in results)))
    aggregate = {}
    for name in metric_names:
        values = [result["metrics"][name] for result in results]
        if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in values):
            aggregate[name] = {"mean": round(mean(values), 4), "stddev": round(pstdev(values), 4), "min": round(min(values), 4), "max": round(max(values), 4)}
    return {"metrics": aggregate, "processes": [], "slices": [], "fairness_trace": [], "guard_events": [], "configuration": results[0]["configuration"]}


def make_hnwf_config(overrides: dict | None) -> HNWFConfig:
    if overrides is None:
        return HNWFConfig()
    allowed = {"gmax", "protected_quantum", "boost_interval", "max_boost", "debt_epsilon", "context_switch_cost"}
    unknown = set(overrides) - allowed
    if unknown:
        raise SimulationError("INVALID_HNWF_CONFIG", f"Unknown HNWF settings: {sorted(unknown)}", "hnwf")
    try:
        return HNWFConfig(**overrides)
    except (TypeError, ValueError) as exc:
        raise SimulationError("INVALID_HNWF_CONFIG", str(exc), "hnwf") from exc


def simulate_request(*, workload: str = "normal", seed: int | str = 0, algorithms: Iterable[str] = ALGORITHMS, quantum: int = 2, custom_processes: Iterable[Any] | None = None, hnwf: dict | None = None) -> dict:
    if isinstance(quantum, bool) or not isinstance(quantum, int) or quantum < 1:
        raise SimulationError("INVALID_QUANTUM", "Quantum must be a positive integer.", "quantum")
    selected = [normalize_algorithm(name) for name in algorithms]
    if not selected:
        raise SimulationError("UNSUPPORTED_ALGORITHM", "Select at least one algorithm.", "algorithms")
    if len(set(selected)) != len(selected):
        raise SimulationError("DUPLICATE_ALGORITHM", "Algorithms must be unique.", "algorithms")
    config = make_hnwf_config(hnwf)
    custom = list(custom_processes or [])
    if custom:
        frame = frame_from_custom(custom)
        return {"status": "success", "source": "custom_processes", "workload": "custom", "seed": seed, "quantum": quantum, "process_count": len(frame), "trace_available": True, "results": {name: run_algorithm(name, frame, quantum, config) for name in selected}}
    if str(seed).lower() in {"mean", "summary"}:
        by_algorithm = {name: [] for name in selected}
        for run_seed in range(10):
            frame = load_workload(workload, run_seed)
            for name in selected:
                by_algorithm[name].append(run_algorithm(name, frame, quantum, config))
        return {"status": "success", "source": f"aggregate_across_10_seeds_{workload}", "workload": workload, "seed": "mean", "quantum": quantum, "process_count_per_run": 25, "trace_available": False, "results": {name: _aggregate_algorithm(values) for name, values in by_algorithm.items()}}
    try:
        run_seed = int(seed)
    except (TypeError, ValueError) as exc:
        raise SimulationError("INVALID_SEED", "Seed must be 0..9 or 'mean'.", "seed") from exc
    frame = load_workload(workload, run_seed)
    return {"status": "success", "source": f"{workload}_seed{run_seed}.csv", "workload": workload, "seed": run_seed, "quantum": quantum, "process_count": len(frame), "trace_available": True, "results": {name: run_algorithm(name, frame, quantum, config) for name in selected}}
