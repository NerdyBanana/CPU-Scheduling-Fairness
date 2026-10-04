# CPU Scheduling Fairness — FAIR / OS Lab

FAIR / OS compares five classical CPU schedulers and measures how each changes when supervised by **Hybrid Nice-Weighted Fairness (HNWF)**. HNWF is a fairness layer—not a sixth baseline scheduler—and combines Linux-style nice weights, virtual runtime, weighted fairness debt, ML starvation/unfairness risk estimates, temporary boosts, and an emergency service-gap guard.

## Algorithms

- FCFS
- SJF
- SRTF
- Round Robin
- Non-preemptive Priority

Each baseline can also run as `Algorithm + HNWF` for direct comparison.

## Four interactive views

1. **Overview** — comparison metrics and linked fairness events.
2. **Simulation** — workload controls, circular process lifecycle, animated dispatch, and execution timeline.
3. **Fairness** — interactive base-versus-HNWF fairness, starvation, and ML-intervention comparisons.
4. **Process** — one process from arrival through nice mapping, weight, ideal service, debt, guard, and completion.

## Quick start on Windows

From PowerShell in this directory:

```powershell
.\scripts\start.ps1 -Install
```

The first run creates `.venv` and installs the declared dependencies. Later runs can omit `-Install`:

```powershell
.\scripts\start.ps1
```

- Frontend: `http://127.0.0.1:5500`
- API documentation: `http://127.0.0.1:8000/docs`
- Stop both servers with `Ctrl+C` in the launcher window.

## Verification

```powershell
.\scripts\test.ps1
```

This runs the Python scheduler/API suite, JavaScript data-layer test, and JavaScript syntax checks.

## Frozen HNWF configuration

| Parameter | Value |
|---|---:|
| Service-gap target (`gmax`) | 32 ms |
| Protected quantum | 1 ms |
| Boost interval | 8 ms |
| Maximum boost | 4 |
| Debt epsilon | 0.25 ms |
| Context-switch cost | 0 ms |

The configuration was selected using seeds 0–5 and evaluated on untouched seeds 6–9. It achieved mean held-out weighted-service fairness of `0.9814`. Three of 300 held-out processes exceeded the 32 ms target by 1 ms, so `gmax` is an emergency-dispatch target—not a proven strict upper bound.

## Project structure

```text
backend/       FastAPI adapter and framework-independent simulation service
phase1_only/   Original baseline schedulers and metrics
phase2/        HNWF engine, models, metrics, and calibration
frontend/      Four-view static web application
data/          30 deterministic workload datasets
results/       Phase 1 and Phase 3 benchmark artifacts
tests/         Engine, service, API, and frontend-contract tests
docs/          Architecture, API, validation, backend, and handoff notes
scripts/       Local startup and verification commands
```

## Evidence and limitations

- The frontend consumes backend-generated slices and never reconstructs HNWF execution.
- Aggregate responses contain statistics only; they do not pretend seed-zero traces are averages.
- Waiting-time Jain equality and weighted-service fairness are different metrics.
- HNWF improves weighted service balance but does not minimize average waiting time.
- The visual implementation follows the supplied reference screenshots; a later Figma MCP pass can refine pixel-level differences when quota is available.

See [Phase 3 validation](docs/PHASE3_VALIDATION.md) and [final handoff](docs/PHASE6_HANDOFF.md) for the complete evidence trail.
