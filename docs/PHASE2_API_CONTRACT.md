# Phase 2 HNWF Supervisor API Contract

**Version:** 2.1.0  
**Status:** Backend implemented; legacy alias retained for frontend compatibility

## 1. Endpoint

```http
POST /api/simulate
Content-Type: application/json
```

The endpoint retains the Phase 1 algorithms and adds an explicit HNWF-supervised variant for each one. `HNWF` temporarily aliases `SRTF+HNWF` for the existing frontend.

## 2. Request

```json
{
  "workload": "skewed",
  "seed": 4,
  "algorithms": ["SRTF", "SRTF+HNWF", "RR", "RR+HNWF"],
  "quantum": 2,
  "hnwf": {
    "gmax": 32,
    "protected_quantum": 1,
    "boost_interval": 8,
    "max_boost": 4,
    "debt_epsilon": 0.25,
    "context_switch_cost": 0
  },
  "custom_processes": null
}
```

| Field | Type | Meaning |
|---|---|---|
| `workload` | string | `normal`, `skewed`, or `bursty` |
| `seed` | integer or `"mean"` | Concrete run or aggregate request |
| `algorithms` | string array | Base policies and `FCFS+HNWF`, `SJF+HNWF`, `SRTF+HNWF`, `RR+HNWF`, `Priority+HNWF`; legacy `HNWF` is accepted |
| `quantum` | integer | Round Robin quantum only |
| `hnwf` | object | Optional HNWF override |
| `custom_processes` | array or null | Overrides workload/seed when non-empty |

HNWF validation:

- `gmax >= 1`;
- `1 <= protected_quantum <= gmax`;
- `boost_interval >= 1`;
- `max_boost >= 0`;
- `debt_epsilon >= 0`;
- `context_switch_cost >= 0`.

A custom process is:

```json
{"pid":"P3","arrival":3,"burst":7,"priority":8}
```

PIDs are unique; arrival is nonnegative; burst is positive; priority is `1..9`.

## 3. Concrete-run response

Concrete seeds and custom workloads return full traces:

```json
{
  "status": "success",
  "source": "skewed_seed4.csv",
  "workload": "skewed",
  "seed": 4,
  "process_count": 6,
  "trace_available": true,
  "results": {
    "HNWF": {
      "metrics": {},
      "processes": [],
      "slices": [],
      "fairness_trace": [],
      "guard_events": [],
      "configuration": {}
    }
  }
}
```

## 4. Metrics

```json
{
  "avg_waiting_time": 20.2,
  "avg_turnaround_time": 31.0,
  "avg_response_time": 5.4,
  "max_waiting_time": 42,
  "p95_waiting_time": 37.5,
  "waiting_time_stddev": 8.1,
  "throughput": 0.09375,
  "cpu_utilization": 1.0,
  "legacy_jains_waiting_index": 0.81,
  "weighted_service_fairness": 0.94,
  "legacy_starvation_count": 0,
  "max_service_gap": 24,
  "p95_service_gap": 21.0,
  "guard_activations": 2,
  "guard_bound_violations": 0,
  "protected_service_time": 4,
  "preemptions": 5,
  "context_switches": 14,
  "context_switch_overhead": 0,
  "max_slowdown": 2.4,
  "p95_slowdown": 2.1,
  "max_positive_debt": 3.6,
  "final_total_absolute_debt": 1.2
}
```

These numbers illustrate the schema and are not validated results. Snake case is canonical. Existing Phase 1 camel-case aliases may remain during migration.

## 5. Process result

```json
{
  "pid": "P3",
  "arrival": 3,
  "burst": 7,
  "priority": 8,
  "nice": 3,
  "weight": 526,
  "start": 14,
  "completion": 41,
  "waiting": 31,
  "turnaround": 38,
  "response": 11,
  "slowdown": 5.4286,
  "actual_service": 7.0,
  "ideal_service": 7.2,
  "final_fairness_debt": 0.2,
  "max_positive_debt": 3.6,
  "final_vruntime": 13.6274,
  "max_service_gap": 20,
  "preemptions": 2,
  "guard_activations": 0,
  "state": "COMPLETED"
}
```

For every completed process, `actual_service == burst`.

## 6. Execution slice

```json
{
  "decision_id": 17,
  "pid": "P4",
  "start": 28,
  "end": 30,
  "duration": 2,
  "reason": "HARD_GUARD",
  "protected": true,
  "context_switch_before": true
}
```

Allowed reasons: `HARD_GUARD`, `FAIRNESS_DEBT`, `TEMPORARY_BOOST`, and `SRTF_FALLBACK`.

Adjacent intervals are coalesced only when PID, reason, and protection state match.

## 7. Fairness trace

```json
{
  "decision_id": 17,
  "time": 28,
  "selected_pid": "P4",
  "reason": "HARD_GUARD",
  "protected_until": 30,
  "total_ready_weight": 5598,
  "runnable_pids": ["P1", "P2", "P3", "P4", "P5", "P6"],
  "candidates": [
    {
      "pid": "P4",
      "remaining": 16,
      "nice": -3,
      "weight": 1991,
      "ideal_service": 27.6,
      "actual_service": 24.0,
      "fairness_debt": 3.6,
      "vruntime": 12.3456,
      "service_gap": 24,
      "boost": 3,
      "guard_eligible": true
    }
  ]
}
```

The example abbreviates `candidates`. A real trace entry contains one candidate for every PID in `runnable_pids`.

## 8. Guard event

```json
{
  "decision_id": 17,
  "pid": "P4",
  "trigger_time": 28,
  "observed_gap": 24,
  "gmax": 24,
  "service_start": 28,
  "service_end": 30,
  "protected_service": 2,
  "completed_during_guard": false,
  "resolved": true
}
```

Each guard event references a protected slice with the same decision ID, PID, and interval.

## 9. Configuration echo

```json
{
  "policy": "HNWF",
  "policy_version": "1.0.0",
  "gmax": 32,
  "protected_quantum": 1,
  "boost_interval": 8,
  "max_boost": 4,
  "debt_epsilon": 0.25,
  "context_switch_cost": 0,
  "nice_mapping": "priority_minus_5",
  "nice_weights": {
    "-4": 2501,
    "-3": 1991,
    "-2": 1586,
    "-1": 1277,
    "0": 1024,
    "1": 820,
    "2": 655,
    "3": 526,
    "4": 423
  }
}
```

Every HNWF result echoes its effective configuration so reports remain reproducible.

## 10. Aggregate response

When `seed` is `"mean"`, return aggregate metrics without presenting seed-zero processes or slices as an average trace:

```json
{
  "status": "success",
  "source": "aggregate_across_10_seeds_skewed",
  "workload": "skewed",
  "seed": "mean",
  "process_count_per_run": 25,
  "trace_available": false,
  "results": {
    "HNWF": {
      "metrics": {
        "avg_waiting_time": {
          "mean": 20.2,
          "stddev": 2.8,
          "min": 16.1,
          "max": 24.7
        }
      },
      "processes": [],
      "slices": [],
      "fairness_trace": [],
      "guard_events": [],
      "configuration": {}
    }
  }
}
```

Simulation and Process Explorer require a concrete seed. Overview may use aggregate metrics.

## 11. Errors

Validation errors use HTTP 422. Unsupported algorithms or missing workloads use HTTP 400/404 as appropriate.

```json
{
  "detail": {
    "code": "DUPLICATE_PID",
    "message": "Each process PID must be unique.",
    "field": "custom_processes[3].pid"
  }
}
```

Stable codes include `DUPLICATE_PID`, `INVALID_ARRIVAL`, `INVALID_BURST`, `INVALID_PRIORITY`, `INVALID_HNWF_CONFIG`, `UNSUPPORTED_ALGORITHM`, and `WORKLOAD_NOT_FOUND`.

## 12. Compatibility rules

1. Phase 1 aliases remain during migration.
2. HNWF uses the six-section result structure.
3. The frontend consumes backend slices and never reconstructs schedules.
4. Frozen names require a contract-version change before modification.
5. Source and effective configuration are returned for reproducibility.

## 13. Acceptance tests

The contract is complete when tests confirm:

- concrete HNWF runs return all six sections;
- aggregate runs return no misleading sample trace;
- candidates match the full runnable set;
- slice duration equals `end - start`;
- actual service equals burst;
- guard events match protected slices;
- configuration is echoed exactly;
- invalid process data and settings return stable errors.
