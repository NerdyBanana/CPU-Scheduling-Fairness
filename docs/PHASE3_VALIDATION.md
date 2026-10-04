# Phase 3 — HNWF calibration and validation

## Protocol

- Calibration data: normal, skewed, and bursty workloads; seeds 0 through 5.
- Held-out data: the same workload families; seeds 6 through 9.
- Adversarial data: single process, repeated late short jobs, priority pressure, and an arrival wave.
- Search: 96 deterministic configurations.
- Selection is lexicographic: fewest guard violations, smallest `gmax`, smallest worst and P95 service gaps, highest weighted-service fairness, lowest waiting time, then lowest context switches.

The held-out seeds never participate in configuration selection.

## Frozen configuration

| Parameter | Value |
|---|---:|
| `gmax` | 32 ms |
| `protected_quantum` | 1 ms |
| `boost_interval` | 8 ms |
| `max_boost` | 4 |
| `debt_epsilon` | 0.25 ms |
| `context_switch_cost` | 0 ms |

## Calibration result

Across 18 tuning runs containing 450 processes:

- guard-bound violations: 0;
- worst service gap: 32 ms;
- mean weighted-service fairness: 0.9793;
- mean average waiting time: 217.05 ms.

## Held-out result

Across 12 unseen runs containing 300 processes:

- mean weighted-service fairness: 0.9814;
- mean average waiting time: 218.57 ms;
- mean context switches: 461.42;
- worst service gap: 33 ms;
- processes exceeding the 32 ms target: 3.

The three violations exceeded the target by 1 ms. Therefore, the guard is validated as a deterministic emergency-dispatch rule, but **32 ms must not be described as a proven hard upper bound**. Multiple processes can become guard-eligible together on a single CPU.

## Common held-out comparison

| Algorithm | Mean wait | Mean maximum wait | Legacy waiting Jain index | Legacy starvation count |
|---|---:|---:|---:|---:|
| SRTF | 115.75 | 401.42 | 0.4787 | 4.58 |
| SJF | 119.64 | 401.42 | 0.5015 | 4.50 |
| Priority | 150.32 | 413.67 | 0.5799 | 3.00 |
| FCFS | 209.39 | 426.92 | 0.7094 | 1.58 |
| HNWF | 218.57 | 416.42 | 0.7374 | 2.58 |
| RR | 233.41 | 408.33 | 0.7635 | 2.33 |

HNWF trades average waiting time for more balanced service. Its mean wait is lower than Round Robin but higher than SRTF, SJF, Priority, and FCFS. The legacy waiting-time Jain index is not the same quantity as weighted-service fairness, so these two measures must not be compared as if they were interchangeable.

## Adversarial result

HNWF completed every adversarial workload without a guard-target violation. Weighted-service fairness was 1.0000 for the single process, 0.9345 for late short jobs, 0.9388 under priority pressure, and 0.7564 for the arrival wave.

## Reproduction

Run:

```powershell
python -m phase2.calibration
```

Generated artifacts are stored in `results/phase3_*`.
