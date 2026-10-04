# Phase 2 Architecture: HNWF Fairness Supervisor

**Version:** 2.1.0  
**Status:** ML-supported supervisor implemented; frontend migration pending  
**Scope:** Workload-aware fairness supervision over immutable Phase 1 baselines

## 1. Objective

Phase 2 adds **HNWF (Hybrid Nice-Weighted Fairness)** as a supervisor over FCFS, SJF, SRTF, Round Robin, and Priority. Each base policy proposes a process. HNWF accepts that proposal unless predicted risk or the hard safety guard justifies a temporary adjustment.

HNWF combines Linux-inspired nice weights, weighted entitlement, and virtual runtime; two logistic-regression risk heads; temporary recovery service; and an explicit hard service-gap guard. There is no fixed SRTF fallback: the selected Phase 1 policy is always the fallback.

Runtime inference is deterministic for a frozen model artifact. The models predict near-horizon starvation and unfairness risk from decision-time process and workload characteristics. They do not use future arrivals, final waiting time, completion time, or other outcome leakage.

## 2. Prediction boundary

The predictor is trained on Phase 1 traces using seeds 0–5, calibrated on seeds 6–7, and tested on seeds 8–9. HNWF uses only state observable at scheduling time: arrival, remaining burst, dataset priority, service received, weighted entitlement, time since service, ready-queue pressure, workload burst variation, recent arrival rate, and the base policy proposal.

The existing rule `Waiting_Time > 2 * Avg_Waiting_Time` remains a **legacy post-run outlier metric**. It is not a runtime starvation guarantee because the final average is unknown during execution.

## 3. Package boundaries

```text
phase1_baseline/
├── phase1_only/                 # Immutable Phase 1 baselines
├── phase2/                      # HNWF monitor, predictors, training and supervisor
│   ├── config.py
│   ├── models.py
│   ├── nice_weights.py
│   ├── hnwf.py                 # Legacy standalone reference
│   ├── supervisor.py           # Base policy + HNWF runtime
│   ├── risk_model.py           # Dependency-free runtime inference
│   ├── train_risk_models.py    # Reproducible sklearn training
│   ├── risk_models.json        # Frozen coefficients and evaluation metadata
│   ├── metrics.py
│   └── experiments.py
├── backend/app.py               # Integrates HNWF without duplicating logic
├── frontend/                    # Four finalized UI views
└── tests/                       # Invariants, decisions, edge cases, API
```

Phase 1 scheduler files must not be edited to implement HNWF.

## 4. Input model

| Field | Symbol | Meaning | Constraint |
|---|---:|---|---|
| `PID` | `pid_i` | Stable process identifier | Unique, non-empty |
| `Arrival_Time` | `A_i` | Entry time into the ready set | Integer `>= 0` |
| `Burst_Time` | `B_i` | Required CPU service | Integer `> 0` |
| `Priority` | `P_i` | Dataset priority; 1 is highest | Integer `1..9` |

Arrival is provided by the dataset or custom input. The scheduler never invents or changes it.

## 5. Priority, nice value, and weight

The project maps the Phase 1 priority scale to a centered nice scale:

```text
nice_i = P_i - 5
```

The subtraction by five is a project mapping, not a Linux kernel formula.

| Priority | Nice | Weight |
|---:|---:|---:|
| 1 | -4 | 2501 |
| 2 | -3 | 1991 |
| 3 | -2 | 1586 |
| 4 | -1 | 1277 |
| 5 | 0 | 1024 |
| 6 | +1 | 820 |
| 7 | +2 | 655 |
| 8 | +3 | 526 |
| 9 | +4 | 423 |

The fixed table is authoritative. `weight_i ≈ 1024 * 1.25^(-nice_i)` is only an explanation. `1024` is the nice-zero reference weight, not a priority.

## 6. Runtime state

Each process stores remaining burst `R_i`, actual service `S_i`, ideal service `I_i`, debt `D_i`, virtual runtime `V_i`, first-run/completion times, last-service end, maximum service gap, preemptions, and guard activations.

At time `t`, the runnable set is:

```text
R(t) = { i | A_i <= t and R_i(t) > 0 }
```

Only arrived, unfinished processes contribute to total weight and ideal service.

If a process arrives while others are runnable, initialize it at the minimum current virtual runtime. Otherwise initialize it at zero:

```text
V_i(arrival) = min(V_j for j in R(t)), or 0 when R(t) is empty
```

## 7. Weighted entitlement and fairness debt

For interval `delta_t`, calculate the runnable set before executing:

```text
W_total(t) = sum(weight_j for j in R(t))
share_i(t) = weight_i / W_total(t)
I_i(t + delta_t) = I_i(t) + delta_t * share_i(t)
```

Only selected process `k` receives actual service:

```text
S_k(t + delta_t) = S_k(t) + delta_t
D_i(t) = I_i(t) - S_i(t)
```

Positive debt means service is owed; negative debt means the process is ahead. Debt is calculated for the complete runnable set, not a shortened display example.

## 8. Virtual runtime

When process `k` runs:

```text
V_k(t + delta_t) = V_k(t) + delta_t * 1024 / weight_k
```

High-weight processes accumulate virtual runtime more slowly. Virtual runtime is recorded for explanation and validation; the actual dispatch hierarchy is explicit below.

## 9. Service gap and hard guard

For a ready process:

```text
service_gap_i(t) = t - A_i                before its first service
service_gap_i(t) = t - last_service_end_i otherwise
```

The gap is zero while running. If any process reaches `service_gap_i >= G_max`, choose the largest gap, then arrival and PID. Protect it for:

```text
min(protected_quantum, remaining_burst_i)
```

Normal arrivals and SRTF comparisons cannot interrupt this interval. Completion may end it early. The hard guard—not nice values, debt, or boosts—is the bounded-service mechanism.

## 10. Temporary recovery boost

```text
boost_i(t) = min(B_max, floor(service_gap_i(t) / T_boost))
```

This Windows-inspired signal does not permanently change dataset priority or nice weight. After service, the gap resets and the derived boost falls. Boost is considered only when no guard is active and no process has meaningful positive debt.

## 11. Supervised dispatch hierarchy

At each legal decision boundary for the selected base policy:

1. **Base proposal:** FCFS, SJF, SRTF, RR, or Priority proposes a PID.
2. **Hard guard:** choose the largest gap when any gap reaches `G_max`.
3. **Predicted starvation:** protect the highest eligible starvation-risk process.
4. **Predicted unfairness:** protect the highest eligible under-served process.
5. **Base fallback:** accept the original base proposal.

ML intervention is rate-limited by the configured boost interval. Non-preemptive policies are reconsidered only after completion, RR at a quantum boundary, and SRTF each millisecond.

Decision reasons are `HARD_GUARD`, `ML_STARVATION_RISK`, `ML_UNFAIRNESS_RISK`, and `BASE_POLICY`.

## 12. Simulation and slices

The reference simulator advances at one-millisecond granularity. Consecutive milliseconds are coalesced only when PID, reason, and protection state are unchanged. One simulator produces lifecycle rows, slices, fairness traces, and guard events; the frontend never reconstructs schedules.

## 13. Initial configuration

| Setting | API field | Initial value | Status |
|---|---|---:|---|
| Service-gap target | `gmax` | `32 ms` | Frozen after Phase 3 calibration |
| Protected service | `protected_quantum` | `1 ms` | Frozen after Phase 3 calibration |
| Boost interval | `boost_interval` | `8 ms` | Frozen after Phase 3 calibration |
| Maximum boost | `max_boost` | `4` | Frozen after Phase 3 calibration |
| Meaningful debt | `debt_epsilon` | `0.25 ms` | Frozen after Phase 3 calibration |
| Context-switch cost | `context_switch_cost` | `0 ms` | Frozen default; experiments may test nonzero cost |

Formulas and meanings are frozen. Numerical tuning is allowed only through the benchmark protocol, and final results must echo the selected configuration. `gmax` is an emergency-dispatch target rather than a proven upper bound: simultaneous guard-eligible processes can exceed it while another protected process occupies the single CPU. Phase 3 observed a worst held-out gap of 33 ms for the 32 ms target.

## 14. Metrics

Retain Phase 1 average wait, turnaround, response, maximum wait, throughput, utilization, waiting deviation, legacy Jain metric, and legacy starvation count.

Add P95 wait; maximum/P95 slowdown; maximum/P95 service gap; fixed-bound violations; guard activations; protected service; preemptions; context switches; context-switch overhead; maximum positive debt; final absolute debt; and actual-versus-ideal service error.

The report must distinguish waiting-time equality from weighted service fairness. Define:

```text
x_i = actual_service_i / max(ideal_service_i, epsilon)
J_service = (sum x_i)^2 / (n * sum(x_i^2))
```

## 15. Correctness invariants

Tests must verify:

1. exactly-once completion;
2. no execution before arrival;
3. executed service per PID equals burst;
4. no overlapping CPU execution;
5. lifecycle and slice consistency;
6. nonnegative lifecycle values and remaining burst;
7. total actual service equals total burst;
8. ideal-service increments sum to elapsed busy service;
9. completed and not-yet-arrived processes gain no ideal service;
10. every guard event matches a protected slice;
11. identical inputs produce identical traces;
12. invalid and duplicate inputs are rejected.

## 16. Benchmark protocol

Compare HNWF with all five Phase 1 algorithms across normal, skewed, and bursty workloads; seeds 0 through 9; and adversarial custom cases.

- Tune provisional constants on seeds `0..5`.
- Freeze constants.
- Report held-out seeds `6..9` and adversarial cases.

No result is called validated until invariants pass and held-out evaluation is complete.

## 17. Four-view UI mapping

1. **Overview:** comparison, metric explorer, linked events.
2. **Simulation:** controls, process input, CPU/queue, timeline.
3. **Fairness Analysis:** debt, gaps, service allocation, ledger.
4. **Process Explorer:** lifecycle, formulas, virtual runtime, debt, boost, guard, decision reasoning.

Charts support hover, selection, linked highlighting, zoom/brushing where meaningful, and process drill-down. Figma defines the states; the web app supplies real interaction.

## 18. Phase 1 completion gate

This phase is complete when the architecture and API contract agree, no active document presents HNWF as a sixth base scheduler, Phase 1 remains isolated, the frozen risk artifact is reproducible, and the invariant/benchmark gates are accepted.
