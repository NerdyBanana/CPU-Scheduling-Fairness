"""Metrics derived from one completed HNWF simulation."""

from __future__ import annotations

from typing import Iterable

import numpy as np

from .config import HNWFConfig
from .models import ProcessState


def _jain(values: Iterable[float]) -> float:
    array = np.asarray(list(values), dtype=float)
    if len(array) == 0 or np.allclose(array, 0.0):
        return 1.0
    denominator = len(array) * float(np.square(array).sum())
    return float(array.sum() ** 2 / denominator) if denominator else 1.0


def _round(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def compute_phase2_metrics(
    states: list[ProcessState],
    slices: list[dict],
    config: HNWFConfig,
    context_switches: int,
    context_switch_overhead: int,
) -> dict:
    arrivals = np.asarray([p.arrival for p in states], dtype=float)
    completions = np.asarray([p.completion for p in states], dtype=float)
    bursts = np.asarray([p.burst for p in states], dtype=float)
    turnaround = completions - arrivals
    waiting = turnaround - bursts
    response = np.asarray([p.first_run - p.arrival for p in states], dtype=float)
    slowdown = turnaround / bursts
    service_gaps = np.asarray([p.max_service_gap for p in states], dtype=float)

    elapsed = float(completions.max() - arrivals.min())
    total_burst = float(bursts.sum())
    legacy_threshold = 2.0 * float(waiting.mean()) if waiting.mean() > 0 else 0.0
    normalized_service = [
        p.actual_service / max(p.ideal_service, 1e-12)
        for p in states
    ]

    protected_service = sum(s["duration"] for s in slices if s["protected"])
    return {
        "avg_waiting_time": _round(waiting.mean()),
        "avg_turnaround_time": _round(turnaround.mean()),
        "avg_response_time": _round(response.mean()),
        "max_waiting_time": _round(waiting.max()),
        "p95_waiting_time": _round(np.percentile(waiting, 95)),
        "waiting_time_stddev": _round(waiting.std(ddof=1) if len(waiting) > 1 else 0.0),
        "throughput": _round(len(states) / elapsed if elapsed else 0.0, 6),
        "cpu_utilization": _round(total_burst / elapsed if elapsed else 0.0),
        "legacy_jains_waiting_index": _round(_jain(waiting)),
        "weighted_service_fairness": _round(_jain(normalized_service)),
        "legacy_starvation_count": int(np.sum(waiting > legacy_threshold)),
        "legacy_starvation_threshold": _round(legacy_threshold),
        "max_service_gap": _round(service_gaps.max()),
        "p95_service_gap": _round(np.percentile(service_gaps, 95)),
        "guard_activations": int(sum(p.guard_activations for p in states)),
        "guard_bound_violations": int(sum(p.max_service_gap > config.gmax for p in states)),
        "protected_service_time": int(protected_service),
        "preemptions": int(sum(p.preemptions for p in states)),
        "context_switches": int(context_switches),
        "context_switch_overhead": int(context_switch_overhead),
        "max_slowdown": _round(slowdown.max()),
        "p95_slowdown": _round(np.percentile(slowdown, 95)),
        "max_positive_debt": _round(max(p.max_positive_debt for p in states)),
        "final_total_absolute_debt": _round(sum(abs(p.fairness_debt) for p in states)),
    }
