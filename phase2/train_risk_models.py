"""Train the frozen dual logistic-regression model used by HNWF.

Rows are decision-time process snapshots reconstructed from unmodified Phase 1
schedules.  Seeds are split by simulation rather than randomly by row so that
near-identical snapshots from one run cannot leak across train and test sets.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from backend.service import _baseline_result
from phase2.hnwf import _build_states, _runnable
from phase2.risk_model import DEFAULT_ARTIFACT, FEATURE_NAMES, feature_vector, workload_statistics


BASE_ALGORITHMS = ("FCFS", "SJF", "SRTF", "RR", "Priority")
GMAX = 32
HORIZON = 16
DEBT_LIMIT = 2.0


def _timeline(result: dict) -> tuple[dict[int, str], int]:
    timeline: dict[int, str] = {}
    end = 0
    for slice_ in result["slices"]:
        for time in range(int(slice_["start"]), int(slice_["end"])):
            timeline[time] = str(slice_["pid"])
        end = max(end, int(slice_["end"]))
    return timeline, end


def snapshot_rows(frame: pd.DataFrame, algorithm: str, quantum: int = 2) -> list[dict]:
    result = _baseline_result(algorithm, frame.copy(), quantum)
    timeline, end = _timeline(result)
    states = _build_states(frame.copy())
    stats = workload_statistics(states)
    records: list[dict] = []

    for time in range(min(process.arrival for process in states), end):
        ready = _runnable(states, time)
        if not ready:
            continue
        base_pid = timeline.get(time)
        for process in ready:
            records.append({
                "time": time,
                "pid": process.pid,
                "features": feature_vector(process, ready, states, time, algorithm, base_pid, stats),
                "service_gap": process.service_gap(time),
                "debt": process.fairness_debt,
            })

        total_weight = sum(process.weight for process in ready)
        for process in ready:
            process.ideal_service += process.weight / total_weight
        if base_pid is None:
            continue
        selected = next(process for process in ready if process.pid == base_pid)
        selected.actual_service += 1.0
        selected.remaining -= 1
        selected.last_service_end = time + 1
        for process in ready:
            process.fairness_debt = process.ideal_service - process.actual_service

    by_pid: dict[str, list[dict]] = {}
    for record in records:
        by_pid.setdefault(record["pid"], []).append(record)
    for process_records in by_pid.values():
        for index, record in enumerate(process_records):
            limit = record["time"] + HORIZON
            future = []
            for candidate in process_records[index:]:
                if candidate["time"] > limit:
                    break
                future.append(candidate)
            record["starvation"] = int(max(item["service_gap"] for item in future) >= GMAX)
            record["unfairness"] = int(max(item["debt"] for item in future) >= DEBT_LIMIT)
    return records


def dataset(data_dir: Path, seeds: range) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rows: list[dict] = []
    for workload in ("normal", "skewed", "bursty"):
        for seed in seeds:
            frame = pd.read_csv(data_dir / f"{workload}_seed{seed}.csv")
            for algorithm in BASE_ALGORITHMS:
                rows.extend(snapshot_rows(frame, algorithm))
    x = np.asarray([row["features"] for row in rows], dtype=float)
    y_starvation = np.asarray([row["starvation"] for row in rows], dtype=int)
    y_unfairness = np.asarray([row["unfairness"] for row in rows], dtype=int)
    return x, y_starvation, y_unfairness


def _scores(y_true: np.ndarray, probability: np.ndarray, threshold: float) -> dict:
    predicted = probability >= threshold
    tp = int(np.sum(predicted & (y_true == 1)))
    fp = int(np.sum(predicted & (y_true == 0)))
    fn = int(np.sum(~predicted & (y_true == 1)))
    tn = int(np.sum(~predicted & (y_true == 0)))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "threshold": round(float(threshold), 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "positive_rate": round(float(np.mean(y_true)), 4),
        "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
    }


def _select_threshold(y_true: np.ndarray, probability: np.ndarray, beta: float) -> float:
    best = (float("-inf"), 0.5)
    beta_squared = beta * beta
    for threshold in np.arange(0.15, 0.901, 0.025):
        scores = _scores(y_true, probability, float(threshold))
        precision, recall = scores["precision"], scores["recall"]
        denominator = beta_squared * precision + recall
        f_beta = (1 + beta_squared) * precision * recall / denominator if denominator else 0.0
        candidate = (f_beta, float(threshold))
        if candidate > best:
            best = candidate
    return best[1]


def train(data_dir: Path, output: Path) -> dict:
    x_train, ys_train, yu_train = dataset(data_dir, range(0, 6))
    x_validation, ys_validation, yu_validation = dataset(data_dir, range(6, 8))
    x_test, ys_test, yu_test = dataset(data_dir, range(8, 10))

    scaler = StandardScaler().fit(x_train)
    train_scaled = scaler.transform(x_train)
    validation_scaled = scaler.transform(x_validation)
    test_scaled = scaler.transform(x_test)
    starvation = LogisticRegression(max_iter=1000, class_weight="balanced", random_state=0).fit(train_scaled, ys_train)
    unfairness = LogisticRegression(max_iter=1000, class_weight="balanced", random_state=0).fit(train_scaled, yu_train)

    starvation_validation = starvation.predict_proba(validation_scaled)[:, 1]
    unfairness_validation = unfairness.predict_proba(validation_scaled)[:, 1]
    starvation_threshold = _select_threshold(ys_validation, starvation_validation, beta=2.0)
    unfairness_threshold = _select_threshold(yu_validation, unfairness_validation, beta=1.0)

    artifact = {
        "schema_version": 1,
        "feature_names": list(FEATURE_NAMES),
        "scaler": {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
        "models": {
            "starvation": {
                "intercept": float(starvation.intercept_[0]),
                "coefficients": starvation.coef_[0].tolist(),
                "threshold": starvation_threshold,
            },
            "unfairness": {
                "intercept": float(unfairness.intercept_[0]),
                "coefficients": unfairness.coef_[0].tolist(),
                "threshold": unfairness_threshold,
            },
        },
        "metadata": {
            "model_type": "dual_logistic_regression",
            "training_seeds": [0, 1, 2, 3, 4, 5],
            "validation_seeds": [6, 7],
            "test_seeds": [8, 9],
            "workloads": ["normal", "skewed", "bursty"],
            "base_algorithms": list(BASE_ALGORITHMS),
            "label_horizon_ms": HORIZON,
            "starvation_gap_ms": GMAX,
            "unfairness_debt_ms": DEBT_LIMIT,
            "training_rows": int(len(x_train)),
            "validation_rows": int(len(x_validation)),
            "test_rows": int(len(x_test)),
            "validation": {
                "starvation": _scores(ys_validation, starvation_validation, starvation_threshold),
                "unfairness": _scores(yu_validation, unfairness_validation, unfairness_threshold),
            },
            "held_out_test": {
                "starvation": _scores(ys_test, starvation.predict_proba(test_scaled)[:, 1], starvation_threshold),
                "unfairness": _scores(yu_test, unfairness.predict_proba(test_scaled)[:, 1], unfairness_threshold),
            },
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser(description="Train HNWF starvation and unfairness risk models")
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    parser.add_argument("--output", type=Path, default=DEFAULT_ARTIFACT)
    args = parser.parse_args()
    artifact = train(args.data_dir, args.output)
    print(json.dumps(artifact["metadata"], indent=2))


if __name__ == "__main__":
    main()

