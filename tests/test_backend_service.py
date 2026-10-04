import pytest

from backend.service import ALGORITHMS, SimulationError, simulate_request


def test_concrete_run_returns_all_algorithms_and_hnwf_audit_sections():
    response = simulate_request(workload="normal", seed=0, algorithms=ALGORITHMS, quantum=2)
    assert response["trace_available"] is True
    assert set(response["results"]) == set(ALGORITHMS)
    hnwf = response["results"]["HNWF"]
    assert set(hnwf) == {
        "metrics", "processes", "slices", "fairness_trace", "guard_events", "configuration"
    }
    assert hnwf["configuration"]["gmax"] == 32
    assert hnwf["configuration"]["protected_quantum"] == 1
    assert hnwf["fairness_trace"]
    for decision in hnwf["fairness_trace"]:
        if decision["reason"] != "IDLE_JUMP":
            assert set(decision["runnable_pids"]) == {candidate["pid"] for candidate in decision["candidates"]}


def test_baseline_slices_are_backend_owned_and_service_conserving():
    response = simulate_request(workload="normal", seed=1, algorithms=["SRTF", "Round Robin"], quantum=3)
    assert set(response["results"]) == {"SRTF", "RR"}
    for result in response["results"].values():
        burst = {process["pid"]: process["burst"] for process in result["processes"]}
        executed = {pid: 0 for pid in burst}
        for slice_ in result["slices"]:
            assert slice_["duration"] == slice_["end"] - slice_["start"]
            executed[slice_["pid"]] += slice_["duration"]
        assert executed == burst


def test_aggregate_has_statistics_but_no_fake_seed_zero_trace():
    response = simulate_request(workload="bursty", seed="mean", algorithms=["SRTF", "HNWF"])
    assert response["trace_available"] is False
    assert response["process_count_per_run"] == 25
    for result in response["results"].values():
        assert result["processes"] == []
        assert result["slices"] == []
        assert result["fairness_trace"] == []
        assert result["guard_events"] == []
        assert set(result["metrics"]["avg_waiting_time"]) == {"mean", "stddev", "min", "max"}


def test_custom_hnwf_override_is_echoed_exactly():
    processes = [
        {"pid": "P1", "arrival": 0, "burst": 4, "priority": 2},
        {"pid": "P2", "arrival": 1, "burst": 2, "priority": 8},
    ]
    response = simulate_request(
        custom_processes=processes,
        algorithms=["HNWF"],
        hnwf={"gmax": 12, "protected_quantum": 1, "boost_interval": 4,
              "max_boost": 2, "debt_epsilon": 0.5, "context_switch_cost": 0},
    )
    configuration = response["results"]["HNWF"]["configuration"]
    assert configuration["gmax"] == 12
    assert configuration["boost_interval"] == 4


def test_each_base_policy_has_an_hnwf_supervised_variant():
    variants = ["FCFS+HNWF", "SJF+HNWF", "SRTF+HNWF", "RR+HNWF", "Priority+HNWF"]
    response = simulate_request(workload="normal", seed=0, algorithms=variants, quantum=2)
    for name, result in response["results"].items():
        assert result["configuration"]["role"] == "fairness_supervisor"
        assert result["configuration"]["base_algorithm"] == name.removesuffix("+HNWF")
        assert sum(process["actual_service"] for process in result["processes"]) == sum(process["burst"] for process in result["processes"])
        assert all("starvation_probability" in candidate and "unfairness_probability" in candidate for decision in result["fairness_trace"] for candidate in decision["candidates"])


def test_supervisor_trace_separates_base_proposal_from_final_choice():
    result = simulate_request(workload="skewed", seed=0, algorithms=["SRTF+HNWF"])["results"]["SRTF+HNWF"]
    assert result["fairness_trace"]
    assert all({"base_proposed_pid", "selected_pid", "overridden", "reason"} <= set(decision) for decision in result["fairness_trace"])
    assert result["metrics"]["fairness_overrides"] == sum(decision["overridden"] for decision in result["fairness_trace"])


@pytest.mark.parametrize(
    ("kwargs", "code"),
    [
        ({"algorithms": ["unknown"]}, "UNSUPPORTED_ALGORITHM"),
        ({"quantum": 0}, "INVALID_QUANTUM"),
        ({"seed": 12}, "INVALID_SEED"),
        ({"hnwf": {"gmax": 0}}, "INVALID_HNWF_CONFIG"),
        ({"custom_processes": [
            {"pid": "P1", "arrival": 0, "burst": 1, "priority": 5},
            {"pid": "P1", "arrival": 1, "burst": 1, "priority": 5},
        ]}, "DUPLICATE_PID"),
    ],
)
def test_stable_validation_errors(kwargs, code):
    with pytest.raises(SimulationError) as exc_info:
        simulate_request(**kwargs)
    assert exc_info.value.code == code
