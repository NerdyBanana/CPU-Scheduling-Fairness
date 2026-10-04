from fastapi.testclient import TestClient

from backend.app import app


client = TestClient(app)


def test_health_exposes_hnwf_supervisor():
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["api_version"] == "2.1.0"
    assert "HNWF" in payload["algorithms"]
    assert payload["fairness_role"] == "supervisor"
    assert payload["risk_model"] == "dual_logistic_regression"
    assert "SRTF+HNWF" in payload["fairness_variants"]


def test_frontend_dev_origin_is_allowed_by_cors():
    response = client.options(
        "/api/simulate",
        headers={
            "Origin": "http://127.0.0.1:5500",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5500"


def test_simulation_endpoint_returns_hnwf_trace():
    response = client.post(
        "/api/simulate",
        json={"workload": "normal", "seed": 0, "algorithms": ["HNWF"]},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["trace_available"] is True
    assert payload["results"]["HNWF"]["fairness_trace"]
    assert payload["results"]["HNWF"]["configuration"]["gmax"] == 32
    assert payload["results"]["HNWF"]["configuration"]["base_algorithm"] == "SRTF"
    assert payload["results"]["HNWF"]["configuration"]["role"] == "fairness_supervisor"


def test_explicit_base_plus_hnwf_variant_is_available():
    response = client.post(
        "/api/simulate",
        json={"workload": "normal", "seed": 0, "algorithms": ["Priority", "Priority+HNWF"]},
    )
    assert response.status_code == 200
    supervised = response.json()["results"]["Priority+HNWF"]
    assert supervised["configuration"]["base_algorithm"] == "Priority"
    assert supervised["configuration"]["risk_model"] == "dual_logistic_regression"
    assert supervised["fairness_trace"][0]["base_proposed_pid"]


def test_api_returns_stable_domain_error():
    response = client.post(
        "/api/simulate",
        json={"algorithms": ["HNWF"], "hnwf": {"gmax": 0}},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "INVALID_HNWF_CONFIG"


def test_single_process_custom_workload_is_valid_json_for_every_algorithm():
    response = client.post(
        "/api/simulate",
        json={
            "algorithms": ["FCFS", "SJF", "SRTF", "RR", "Priority", "HNWF"],
            "custom_processes": [{"pid": "P1", "arrival": 5, "burst": 2, "priority": 5}],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert set(payload["results"]) == {"FCFS", "SJF", "SRTF", "RR", "Priority", "HNWF"}
    assert payload["results"]["FCFS"]["metrics"]["waiting_time_stddev"] == 0.0
