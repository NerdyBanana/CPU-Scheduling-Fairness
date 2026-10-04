"""Frozen, explainable starvation and unfairness risk models.

Training uses scikit-learn, but runtime inference intentionally depends only on
the Python standard library.  The generated JSON artifact contains the feature
normalization and logistic-regression coefficients used by every simulation.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Iterable

from .models import ProcessState


FEATURE_NAMES = (
    "wait_so_far",
    "service_gap",
    "fairness_debt",
    "debt_ratio",
    "remaining_ratio",
    "priority",
    "nice",
    "log_weight_ratio",
    "queue_length",
    "mean_ready_remaining",
    "workload_burst_cv",
    "recent_arrival_rate",
    "base_selected",
    "is_fcfs",
    "is_sjf",
    "is_srtf",
    "is_rr",
    "is_priority",
)

DEFAULT_ARTIFACT = Path(__file__).with_name("risk_models.json")


def workload_statistics(states: Iterable[ProcessState]) -> dict[str, float]:
    items = list(states)
    bursts = [float(process.burst) for process in items]
    mean_burst = sum(bursts) / len(bursts)
    variance = sum((value - mean_burst) ** 2 for value in bursts) / len(bursts)
    return {
        "burst_cv": math.sqrt(variance) / mean_burst if mean_burst else 0.0,
    }


def feature_vector(
    process: ProcessState,
    ready: list[ProcessState],
    all_states: list[ProcessState],
    time: int,
    base_algorithm: str,
    base_pid: str | None,
    stats: dict[str, float],
) -> list[float]:
    algorithm = base_algorithm.upper()
    wait_so_far = max(0.0, time - process.arrival - process.actual_service)
    debt_ratio = process.fairness_debt / max(process.ideal_service, 1.0)
    recent_arrivals = sum(1 for item in all_states if max(0, time - 8) < item.arrival <= time)
    return [
        wait_so_far,
        float(process.service_gap(time)),
        float(process.fairness_debt),
        float(debt_ratio),
        float(process.remaining / process.burst),
        float(process.priority),
        float(process.nice),
        float(math.log(max(process.weight, 1) / 1024.0)),
        float(len(ready)),
        float(sum(item.remaining for item in ready) / len(ready)),
        float(stats["burst_cv"]),
        float(recent_arrivals / 8.0),
        float(process.pid == base_pid),
        float(algorithm == "FCFS"),
        float(algorithm == "SJF"),
        float(algorithm == "SRTF"),
        float(algorithm == "RR"),
        float(algorithm == "PRIORITY"),
    ]


@dataclass(frozen=True)
class LogisticHead:
    intercept: float
    coefficients: tuple[float, ...]
    threshold: float


@dataclass(frozen=True)
class RiskPrediction:
    starvation_probability: float
    unfairness_probability: float


class RiskPredictor:
    def __init__(self, artifact: dict):
        if tuple(artifact["feature_names"]) != FEATURE_NAMES:
            raise ValueError("risk model feature schema does not match runtime")
        self.mean = tuple(float(value) for value in artifact["scaler"]["mean"])
        self.scale = tuple(max(float(value), 1e-12) for value in artifact["scaler"]["scale"])
        self.starvation = self._head(artifact["models"]["starvation"])
        self.unfairness = self._head(artifact["models"]["unfairness"])
        self.metadata = dict(artifact.get("metadata", {}))

    @staticmethod
    def _head(payload: dict) -> LogisticHead:
        return LogisticHead(
            intercept=float(payload["intercept"]),
            coefficients=tuple(float(value) for value in payload["coefficients"]),
            threshold=float(payload["threshold"]),
        )

    @classmethod
    def load(cls, path: Path | str = DEFAULT_ARTIFACT) -> "RiskPredictor":
        with Path(path).open("r", encoding="utf-8") as handle:
            return cls(json.load(handle))

    def _probability(self, values: list[float], head: LogisticHead) -> float:
        standardized = [(value - mean) / scale for value, mean, scale in zip(values, self.mean, self.scale, strict=True)]
        score = head.intercept + sum(coefficient * value for coefficient, value in zip(head.coefficients, standardized, strict=True))
        if score >= 0:
            return 1.0 / (1.0 + math.exp(-score))
        exp_score = math.exp(score)
        return exp_score / (1.0 + exp_score)

    def predict(self, values: list[float]) -> RiskPrediction:
        if len(values) != len(FEATURE_NAMES):
            raise ValueError(f"expected {len(FEATURE_NAMES)} risk features, received {len(values)}")
        return RiskPrediction(
            starvation_probability=self._probability(values, self.starvation),
            unfairness_probability=self._probability(values, self.unfairness),
        )

