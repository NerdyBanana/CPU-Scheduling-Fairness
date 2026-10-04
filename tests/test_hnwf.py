import json

import pandas as pd
import pytest

from phase2 import HNWFConfig, NICE_WEIGHTS, nice_from_priority, run_hnwf
from phase2.calibration import adversarial_workloads, iter_configurations, selection_key


def workload(rows):
    return pd.DataFrame(rows, columns=["PID", "Arrival_Time", "Burst_Time", "Priority"])


def test_priority_mapping_and_fixed_weights():
    assert [nice_from_priority(p) for p in range(1, 10)] == list(range(-4, 5))
    assert list(NICE_WEIGHTS.values()) == [2501, 1991, 1586, 1277, 1024, 820, 655, 526, 423]
    with pytest.raises(ValueError):
        nice_from_priority(10)


def test_phase3_calibrated_defaults_are_frozen():
    config = HNWFConfig()
    assert (config.gmax, config.protected_quantum) == (32, 1)
    assert (config.boost_interval, config.max_boost, config.debt_epsilon) == (8, 4, 0.25)


def test_single_process_is_exact_and_has_no_wait():
    result = run_hnwf(workload([["P1", 0, 3, 5]]))
    process = result.processes[0]
    assert process["start"] == 0
    assert process["completion"] == 3
    assert process["waiting"] == 0
    assert process["actual_service"] == 3
    assert result.metrics["context_switches"] == 0
    assert result.slices == [
        {
            "decision_id": 1,
            "pid": "P1",
            "start": 0,
            "end": 3,
            "duration": 3,
            "reason": "SRTF_FALLBACK",
            "protected": False,
            "context_switch_before": False,
        }
    ]


def test_hard_guard_creates_matching_event_and_protected_slice():
    df = workload(
        [
            ["P1", 0, 10, 5],
            ["P2", 0, 1, 5],
            ["P3", 1, 1, 5],
            ["P4", 2, 1, 5],
        ]
    )
    config = HNWFConfig(gmax=2, protected_quantum=1, boost_interval=100, max_boost=0, debt_epsilon=100)
    result = run_hnwf(df, config)
    assert result.guard_events
    event = result.guard_events[0]
    assert event["pid"] == "P1"
    assert event["observed_gap"] >= config.gmax
    assert result.metrics["max_service_gap"] >= config.gmax
    matching = [
        s
        for s in result.slices
        if s["decision_id"] == event["decision_id"] and s["pid"] == event["pid"] and s["protected"]
    ]
    assert matching


def test_positive_debt_is_selected_before_srtf_fallback():
    df = workload([["P1", 0, 5, 1], ["P2", 0, 4, 9], ["P3", 0, 1, 5]])
    config = HNWFConfig(gmax=100, boost_interval=100, max_boost=0, debt_epsilon=0)
    result = run_hnwf(df, config)
    assert result.fairness_trace[0]["selected_pid"] == "P3"
    debt_decisions = [d for d in result.fairness_trace if d["reason"] == "FAIRNESS_DEBT"]
    assert debt_decisions
    assert debt_decisions[0]["selected_pid"] == "P1"


def test_full_runnable_set_is_recorded_for_every_dispatch():
    df = workload([["P1", 0, 3, 5], ["P2", 0, 2, 5], ["P3", 2, 1, 5]])
    result = run_hnwf(df)
    for entry in result.fairness_trace:
        if entry["reason"] == "IDLE_JUMP":
            continue
        assert set(entry["runnable_pids"]) == {c["pid"] for c in entry["candidates"]}
        assert entry["total_ready_weight"] == sum(c["weight"] for c in entry["candidates"])


def test_lifecycle_slice_and_service_invariants():
    df = workload([["P1", 0, 6, 2], ["P2", 1, 3, 8], ["P3", 4, 5, 5]])
    result = run_hnwf(df)
    by_pid = {p["pid"]: p for p in result.processes}
    service = {pid: 0 for pid in by_pid}
    previous_end = None
    for slice_ in result.slices:
        assert slice_["start"] >= by_pid[slice_["pid"]]["arrival"]
        assert slice_["duration"] == slice_["end"] - slice_["start"]
        assert previous_end is None or slice_["start"] >= previous_end
        previous_end = slice_["end"]
        service[slice_["pid"]] += slice_["duration"]
    for pid, process in by_pid.items():
        assert service[pid] == process["burst"] == process["actual_service"]
        assert process["waiting"] >= 0
        assert process["response"] >= 0
        assert process["turnaround"] >= process["burst"]
    assert result.invariant_totals["burst"] == result.invariant_totals["actual_service"]
    assert result.invariant_totals["burst"] == pytest.approx(result.invariant_totals["ideal_service"])


def test_idle_period_jumps_to_arrival_without_fake_cpu_service():
    result = run_hnwf(workload([["P1", 5, 2, 5]]))
    process = result.processes[0]
    assert process["start"] == 5
    assert process["completion"] == 7
    assert process["waiting"] == 0
    assert result.metrics["cpu_utilization"] == 1.0
    assert all(slice_["start"] >= 5 for slice_ in result.slices)


def test_context_switch_cost_is_accounted_without_changing_service_totals():
    df = workload([["P1", 0, 3, 5], ["P2", 0, 1, 5]])
    result = run_hnwf(
        df,
        HNWFConfig(
            gmax=100,
            boost_interval=100,
            max_boost=0,
            debt_epsilon=100,
            context_switch_cost=2,
        ),
    )
    assert result.metrics["context_switches"] == 1
    assert result.metrics["context_switch_overhead"] == 2
    assert result.invariant_totals["actual_service"] == 4
    assert max(p["completion"] for p in result.processes) == 6


def test_deterministic_output():
    df = workload([["P1", 0, 4, 5], ["P2", 0, 4, 5], ["P3", 1, 2, 7]])
    first = run_hnwf(df).to_dict()
    second = run_hnwf(df).to_dict()
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)


@pytest.mark.parametrize(
    "rows",
    [
        [["P1", -1, 2, 5]],
        [["P1", 0, 0, 5]],
        [["P1", 0, 2, 10]],
        [["P1", 0, 2, 5], ["P1", 1, 2, 5]],
    ],
)
def test_invalid_process_input_is_rejected(rows):
    with pytest.raises(ValueError):
        run_hnwf(workload(rows))


def test_invalid_configuration_is_rejected():
    with pytest.raises(ValueError):
        HNWFConfig(gmax=0)
    with pytest.raises(ValueError):
        HNWFConfig(gmax=2, protected_quantum=3)


def test_calibration_grid_is_deterministic_and_respects_values():
    grid = {
        "gmax": (8, 12),
        "protected_quantum": (1,),
        "boost_interval": (4,),
        "max_boost": (2,),
        "debt_epsilon": (0.5, 1.0),
    }
    configs = list(iter_configurations(grid))
    assert len(configs) == 4
    assert [(c.gmax, c.debt_epsilon) for c in configs] == [
        (8, 0.5), (8, 1.0), (12, 0.5), (12, 1.0)
    ]


def test_calibration_selection_prioritizes_bound_then_smallest_gmax():
    base = {
        "worst_service_gap": 20,
        "mean_p95_service_gap": 12,
        "mean_weighted_service_fairness": 0.95,
        "mean_avg_waiting_time": 10,
        "mean_context_switches": 5,
        "protected_quantum": 1,
        "boost_interval": 8,
        "max_boost": 2,
        "debt_epsilon": 0.5,
    }
    violating = {**base, "guard_bound_violations": 1, "gmax": 24}
    safe_large = {**base, "guard_bound_violations": 0, "gmax": 48}
    safe_small = {**base, "guard_bound_violations": 0, "gmax": 32}
    assert min([violating, safe_large, safe_small], key=selection_key) == safe_small


def test_adversarial_workloads_are_valid_and_runnable():
    for frame in adversarial_workloads().values():
        result = run_hnwf(frame, HNWFConfig(gmax=64))
        assert len(result.processes) == len(frame)
        assert result.invariant_totals["burst"] == result.invariant_totals["actual_service"]
