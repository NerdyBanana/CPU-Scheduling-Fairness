"""FastAPI adapter for the Phase 2 scheduling simulation service."""

from __future__ import annotations

from typing import Optional, Union

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .service import ALGORITHMS, BASE_ALGORITHMS, FAIRNESS_VARIANTS, WORKLOADS, SimulationError, load_workload, simulate_request


class ProcessInput(BaseModel):
    pid: str
    arrival: int
    burst: int
    priority: int = 5


class HNWFInput(BaseModel):
    gmax: int = 32
    protected_quantum: int = 1
    boost_interval: int = 8
    max_boost: int = 4
    debt_epsilon: float = 0.25
    context_switch_cost: int = 0


class SimulateRequest(BaseModel):
    workload: str = "normal"
    seed: Union[int, str] = 0
    algorithms: list[str] = Field(default_factory=lambda: list(ALGORITHMS))
    quantum: int = 2
    hnwf: Optional[HNWFInput] = None
    custom_processes: Optional[list[ProcessInput]] = None


app = FastAPI(
    title="CPU Scheduling Fairness Lab API",
    description="Phase 1 schedulers with an auditable ML-supported HNWF fairness supervisor.",
    version="2.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5500", "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _dump(model: BaseModel | None) -> dict | None:
    if model is None:
        return None
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


@app.get("/api/health")
def get_health():
    return {
        "status": "ok",
        "engine": "HNWF Fairness Supervisor Engine",
        "api_version": "2.1.0",
        "algorithms": list(ALGORITHMS),
        "base_algorithms": list(BASE_ALGORITHMS),
        "fairness_variants": list(FAIRNESS_VARIANTS),
        "fairness_role": "supervisor",
        "risk_model": "dual_logistic_regression",
        "workloads": list(WORKLOADS),
        "trace_support": {name: True for name in FAIRNESS_VARIANTS},
    }


@app.get("/api/workload")
def get_workload(
    type: str = Query("normal", pattern="^(normal|skewed|bursty)$"),
    seed: int = Query(0, ge=0, le=9),
    n: int = Query(25, ge=1, le=50),
):
    try:
        frame = load_workload(type, seed, n)
    except SimulationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail()) from exc
    processes = [
        {
            "pid": str(row.PID), "arrival": int(row.Arrival_Time),
            "burst": int(row.Burst_Time), "priority": int(row.Priority),
        }
        for row in frame.itertuples()
    ]
    return {
        "status": "success", "workload": type, "seed": seed,
        "count": len(processes), "processes": processes,
    }


@app.post("/api/simulate")
def simulate(request: SimulateRequest):
    try:
        return simulate_request(
            workload=request.workload,
            seed=request.seed,
            algorithms=request.algorithms,
            quantum=request.quantum,
            custom_processes=request.custom_processes,
            hnwf=_dump(request.hnwf),
        )
    except SimulationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail()) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
