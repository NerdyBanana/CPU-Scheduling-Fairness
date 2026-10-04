# Phase 4 — Backend integration

The backend exposes the five Phase 1 schedulers and five corresponding `Base+HNWF` supervised variants through one simulation contract. The legacy `HNWF` name aliases `SRTF+HNWF` during frontend migration.

## Endpoints

- `GET /api/health`: API version, algorithms, workloads, and trace support.
- `GET /api/workload`: canonical process input for a workload and seed.
- `POST /api/simulate`: concrete, aggregate, or custom-process simulation.

Concrete supervised responses include metrics, lifecycle rows, execution slices, the base proposal, final choice, two risk probabilities per runnable candidate, guard events, and the effective configuration. Baseline algorithms use the same top-level result sections; fields that only the supervisor can measure are not fabricated.

Aggregate requests calculate mean, population standard deviation, minimum, and maximum across all ten seeds. They intentionally return empty process, slice, fairness-trace, and guard-event arrays because a seed-zero trace is not an average trace.

## Start locally

```powershell
python -m venv --system-site-packages .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --reload
```

The API runs at `http://127.0.0.1:8000`; interactive documentation is available at `/docs`.

## Test

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

Domain validation returns stable error codes such as `DUPLICATE_PID`, `INVALID_BURST`, `INVALID_PRIORITY`, `INVALID_HNWF_CONFIG`, and `UNSUPPORTED_ALGORITHM`.
