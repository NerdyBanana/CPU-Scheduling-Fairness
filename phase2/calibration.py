"""Reproducible Phase 3 calibration and held-out validation for HNWF.

The provisional constants are tuned on seeds 0..5 only. The selected
configuration is then frozen and compared with every Phase 1 scheduler on
seeds 6..9 and deterministic adversarial workloads.
"""

from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path
from typing import Iterable

import pandas as pd

from phase1_only.metrics import compute_metrics as compute_phase1_metrics
from phase1_only.schedulers.fcfs import run_fcfs
from phase1_only.schedulers.priority import run_priority
from phase1_only.schedulers.round_robin import run_round_robin
from phase1_only.schedulers.sjf_srtf import run_sjf, run_srtf

from .config import HNWFConfig
from .hnwf import run_hnwf


WORKLOADS = ("normal", "skewed", "bursty")
TUNING_SEEDS = tuple(range(0, 6))
HELD_OUT_SEEDS = tuple(range(6, 10))

# Formulas stay frozen; only these provisional constants are calibrated.
DEFAULT_GRID = {
    "gmax": (24, 32, 48, 64),
    "protected_quantum": (1, 2),
    "boost_interval": (8, 16),
    "max_boost": (2, 4),
    "debt_epsilon": (0.25, 0.5, 1.0),
}

BASELINE_ALGORITHMS = {
    "FCFS": run_fcfs,
    "SJF": run_sjf,
    "SRTF": run_srtf,
    "RR": lambda frame: run_round_robin(frame, quantum=4),
    "Priority": run_priority,
}


def iter_configurations(grid: dict[str, Iterable] | None = None):
    """Yield configurations in a stable order for reproducible tuning."""
    values = grid or DEFAULT_GRID
    names = tuple(values)
    for combination in itertools.product(*(values[name] for name in names)):
        yield HNWFConfig(**dict(zip(names, combination, strict=True)))


def dataset_path(data_dir: Path, workload: str, seed: int) -> Path:
    return data_dir / f"{workload}_seed{seed}.csv"


def _evaluate_configuration(config: HNWFConfig, data_dir: Path) -> dict:
    records = []
    total_processes = 0
    for workload in WORKLOADS:
        for seed in TUNING_SEEDS:
            frame = pd.read_csv(dataset_path(data_dir, workload, seed))
            result = run_hnwf(frame, config)
            total_processes += len(frame)
            records.append(result.metrics)

    metrics = pd.DataFrame(records)
    return {
        "gmax": config.gmax,
        "protected_quantum": config.protected_quantum,
        "boost_interval": config.boost_interval,
        "max_boost": config.max_boost,
        "debt_epsilon": config.debt_epsilon,
        "context_switch_cost": config.context_switch_cost,
        "training_runs": len(records),
        "training_processes": total_processes,
        "guard_bound_violations": int(metrics["guard_bound_violations"].sum()),
        "guard_violation_rate": float(metrics["guard_bound_violations"].sum() / total_processes),
        "worst_service_gap": float(metrics["max_service_gap"].max()),
        "mean_p95_service_gap": float(metrics["p95_service_gap"].mean()),
        "mean_weighted_service_fairness": float(metrics["weighted_service_fairness"].mean()),
        "mean_avg_waiting_time": float(metrics["avg_waiting_time"].mean()),
        "mean_p95_waiting_time": float(metrics["p95_waiting_time"].mean()),
        "mean_context_switches": float(metrics["context_switches"].mean()),
        "mean_guard_activations": float(metrics["guard_activations"].mean()),
    }


def selection_key(row: dict) -> tuple:
    """Transparent lexicographic selection without a unit-mixing score."""
    return (
        row["guard_bound_violations"],
        row["gmax"],
        row["worst_service_gap"],
        row["mean_p95_service_gap"],
        -row["mean_weighted_service_fairness"],
        row["mean_avg_waiting_time"],
        row["mean_context_switches"],
        row["protected_quantum"],
        row["boost_interval"],
        row["max_boost"],
        row["debt_epsilon"],
    )


def calibrate(data_dir: Path, grid: dict[str, Iterable] | None = None) -> tuple[pd.DataFrame, HNWFConfig]:
    rows = [_evaluate_configuration(config, data_dir) for config in iter_configurations(grid)]
    ranked = sorted(rows, key=selection_key)
    for rank, row in enumerate(ranked, start=1):
        row["selection_rank"] = rank
    selected_row = ranked[0]
    selected = HNWFConfig(
        gmax=int(selected_row["gmax"]),
        protected_quantum=int(selected_row["protected_quantum"]),
        boost_interval=int(selected_row["boost_interval"]),
        max_boost=int(selected_row["max_boost"]),
        debt_epsilon=float(selected_row["debt_epsilon"]),
        context_switch_cost=int(selected_row["context_switch_cost"]),
    )
    return pd.DataFrame(ranked), selected


def adversarial_workloads() -> dict[str, pd.DataFrame]:
    columns = ["PID", "Arrival_Time", "Burst_Time", "Priority"]
    return {
        "single_process": pd.DataFrame([["P1", 5, 12, 5]], columns=columns),
        "late_short_jobs": pd.DataFrame(
            [["P1", 0, 60, 5]] + [[f"P{i + 1}", i, 1, 5] for i in range(1, 13)],
            columns=columns,
        ),
        "priority_pressure": pd.DataFrame(
            [[f"P{i + 1}", 0, 12, 1 if i < 6 else 9] for i in range(12)],
            columns=columns,
        ),
        "arrival_wave": pd.DataFrame(
            [[f"P{i + 1}", i // 5, 2 + (i % 7), 1 + (i % 9)] for i in range(25)],
            columns=columns,
        ),
    }


def _baseline_record(frame: pd.DataFrame, name: str, runner) -> dict:
    metrics = compute_phase1_metrics(runner(frame.copy()))
    return {
        "Algorithm": name,
        "avg_waiting_time": metrics["Avg_Waiting_Time"],
        "avg_turnaround_time": metrics["Avg_Turnaround_Time"],
        "avg_response_time": metrics["Avg_Response_Time"],
        "max_waiting_time": metrics["Max_Waiting_Time"],
        "throughput": metrics["Throughput"],
        "cpu_utilization": metrics["CPU_Utilization"],
        "legacy_jains_waiting_index": metrics["Jains_Fairness_Index"],
        "legacy_starvation_count": metrics["Starvation_Count"],
    }


def _hnwf_record(frame: pd.DataFrame, config: HNWFConfig) -> dict:
    return {"Algorithm": "HNWF", **run_hnwf(frame.copy(), config).metrics}


def evaluate_held_out(config: HNWFConfig, data_dir: Path) -> pd.DataFrame:
    records = []
    for workload in WORKLOADS:
        for seed in HELD_OUT_SEEDS:
            frame = pd.read_csv(dataset_path(data_dir, workload, seed))
            for name, runner in BASELINE_ALGORITHMS.items():
                records.append({"Workload": workload, "Seed": seed, **_baseline_record(frame, name, runner)})
            records.append({"Workload": workload, "Seed": seed, **_hnwf_record(frame, config)})
    return pd.DataFrame(records)


def evaluate_adversarial(config: HNWFConfig) -> pd.DataFrame:
    records = []
    for workload, frame in adversarial_workloads().items():
        for name, runner in BASELINE_ALGORITHMS.items():
            records.append({"Workload": workload, "Seed": "adversarial", **_baseline_record(frame, name, runner)})
        records.append({"Workload": workload, "Seed": "adversarial", **_hnwf_record(frame, config)})
    return pd.DataFrame(records)


def summarize_held_out(per_run: pd.DataFrame) -> pd.DataFrame:
    metric_columns = [
        "avg_waiting_time", "avg_turnaround_time", "avg_response_time", "max_waiting_time",
        "throughput", "cpu_utilization", "legacy_jains_waiting_index", "legacy_starvation_count",
        "weighted_service_fairness", "max_service_gap", "p95_service_gap",
        "guard_bound_violations", "context_switches",
    ]
    available = [column for column in metric_columns if column in per_run]
    grouped = per_run.groupby(["Workload", "Algorithm"], sort=True)[available]
    means = grouped.mean().add_suffix("_mean")
    stddev = grouped.std().add_suffix("_std")
    return pd.concat([means, stddev], axis=1).reset_index()


def run_phase3(project_root: Path) -> dict:
    data_dir = project_root / "data"
    output_dir = project_root / "results"
    output_dir.mkdir(parents=True, exist_ok=True)

    tuning, selected = calibrate(data_dir)
    held_out = evaluate_held_out(selected, data_dir)
    adversarial = evaluate_adversarial(selected)
    summary = summarize_held_out(held_out)

    tuning.to_csv(output_dir / "phase3_tuning.csv", index=False)
    held_out.to_csv(output_dir / "phase3_heldout_per_run.csv", index=False)
    adversarial.to_csv(output_dir / "phase3_adversarial.csv", index=False)
    summary.to_csv(output_dir / "phase3_heldout_summary.csv", index=False)

    selected_payload = {
        **selected.to_dict(),
        "selection_protocol": {
            "tuning_workloads": list(WORKLOADS),
            "tuning_seeds": list(TUNING_SEEDS),
            "held_out_seeds": list(HELD_OUT_SEEDS),
            "selection_order": [
                "guard_bound_violations ascending", "gmax ascending",
                "worst_service_gap ascending", "mean_p95_service_gap ascending",
                "mean_weighted_service_fairness descending", "mean_avg_waiting_time ascending",
                "mean_context_switches ascending",
            ],
        },
        "training_result": tuning.iloc[0].to_dict(),
    }
    with (output_dir / "phase3_selected_config.json").open("w", encoding="utf-8") as handle:
        json.dump(selected_payload, handle, indent=2)

    return {
        "selected": selected, "tuning": tuning, "held_out": held_out,
        "adversarial": adversarial, "summary": summary,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrate the legacy standalone HNWF reference policy")
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    outputs = run_phase3(args.project_root.resolve())
    print(json.dumps(outputs["selected"].to_dict(), indent=2))
    print("Saved Phase 3 tuning, held-out, adversarial, and summary results.")


if __name__ == "__main__":
    main()
