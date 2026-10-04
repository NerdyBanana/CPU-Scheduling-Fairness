# Phase 6 — Integration, QA, and handoff

## Completion status

| Area | Status | Evidence |
|---|---|---|
| HNWF supervisor | Complete | Five base-policy adapters, risk traces, invariants, guard events |
| Risk prediction | Complete | Dual logistic regression; seed-grouped train/validation/test split |
| Backend | Complete | Five baselines plus five supervised variants; legacy alias retained |
| Frontend | Migration pending | Current UI still uses the legacy `HNWF` alias |
| Automated checks | Complete | Python, API, frontend contract, JavaScript data, syntax |
| Deployment | Local only | No public hosting was requested |

## Demonstration sequence

1. Open **Overview** and explain that weighted-service fairness and waiting equality are intentionally shown as different ideas.
2. Open **Simulation**, select a workload and seed, and run the simulator.
3. Click a colored execution slice to pin that PID and open its process story.
4. Open **Fairness** and connect debt, service gap, guard activation, and actual-versus-ideal service.
5. Open **Process** and explain the formula journey: priority → nice → weight → ideal share → debt → dispatch.

## Statements safe to make

- Nice value is `priority - 5`, mapping priorities 1–9 to nice values -4 through +4.
- Nice zero uses the reference weight 1024; the fixed Linux-inspired lookup table is authoritative.
- Ideal service is accumulated only while a process is arrived, unfinished, and runnable.
- Fairness debt is `ideal service - actual service`.
- The guard overrides other choices when service gap reaches the configured target.
- Held-out test seeds 8–9 were not used for model fitting or threshold selection.
- Runtime risk inputs contain no future arrival, completion, final waiting, or final-debt outcomes.

## Statements to avoid

- Do not claim HNWF minimizes average waiting time.
- Do not call the legacy waiting Jain index the same as weighted-service fairness.
- Do not claim 32 ms is a strict mathematical maximum. Three held-out processes reached 33 ms.
- Do not describe the nice-weight formula as dynamically calculated; the fixed lookup table is used.
- Do not describe normal/skewed/bursty workload generation as workload prediction; call the model workload-aware risk prediction.

## Verified integration behavior

- The frontend shows `LIVE` when the API succeeds and explicitly shows `DEMO` when it falls back.
- Port 5500 is included in the local CORS allowlist.
- Aggregate results expose mean, standard deviation, minimum, and maximum without a fake process trace.
- Timeline slices conserve every process burst.
- HNWF trace candidates match the complete runnable set at every recorded decision.

## Remaining optional work

- Public deployment and production CORS policy.
- A later Figma MCP alignment pass for pixel-level refinements.
- Export-to-PDF/CSV controls.
- A formal feasibility-aware guard algorithm if a strict upper waiting bound becomes a requirement.
