# HNWF workload-aware risk model

HNWF is a fairness supervisor, not a sixth base scheduler. The unmodified Phase 1 policy proposes a process; HNWF predicts process-level risk and either accepts that proposal or performs a short, auditable intervention.

## Models

The runtime loads `phase2/risk_models.json`, containing two standardized logistic-regression heads:

- starvation: predicts whether a process will cross the 32 ms service-gap target within the next 16 ms;
- unfairness: predicts whether weighted service debt will cross 2 ms within the next 16 ms.

The model uses decision-time values only: current wait, service gap, debt, remaining burst, priority/nice/weight, ready-queue pressure, workload burst variation, recent arrivals, the base proposal, and the base algorithm. Completion time, final waiting time, future arrivals, and final debt are excluded.

## Data split and reproducibility

- training: workload seeds 0–5;
- validation and threshold selection: seeds 6–7;
- held-out test: seeds 8–9;
- workload families: normal, skewed, bursty;
- base policies: FCFS, SJF, SRTF, RR, Priority.

Regenerate the checked-in artifact with:

```powershell
.\.venv\Scripts\python.exe -m phase2.train_risk_models
```

The artifact records row counts, label definitions, thresholds, validation scores, held-out scores, scaling parameters, and model coefficients.

## Runtime decision order

1. the base scheduler proposes a process;
2. the hard service-gap guard takes precedence when already breached;
3. otherwise, an eligible high starvation-risk process may receive a protected slice;
4. otherwise, an under-served high unfairness-risk process may receive a protected slice;
5. otherwise, HNWF accepts the base proposal.

ML interventions have an eight-millisecond default cooldown. This ensures the predictor supervises the base scheduler rather than silently replacing it. Non-preemptive base policies are only reconsidered at dispatch boundaries; RR is reconsidered at quantum boundaries; SRTF is reconsidered each millisecond.

The legacy API name `HNWF` temporarily aliases `SRTF+HNWF` so the existing frontend continues to work. New integrations should request explicit variants such as `FCFS+HNWF` or `Priority+HNWF`.
