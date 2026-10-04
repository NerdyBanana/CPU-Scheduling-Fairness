"""Internal state models used by the HNWF simulator."""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ProcessState:
    pid: str
    arrival: int
    burst: int
    priority: int
    nice: int
    weight: int
    remaining: int
    actual_service: float = 0.0
    ideal_service: float = 0.0
    fairness_debt: float = 0.0
    vruntime: float = 0.0
    first_run: Optional[int] = None
    completion: Optional[int] = None
    last_service_end: Optional[int] = None
    max_service_gap: int = 0
    preemptions: int = 0
    guard_activations: int = 0
    max_positive_debt: float = 0.0

    def service_gap(self, time: int) -> int:
        reference = self.arrival if self.last_service_end is None else self.last_service_end
        return max(0, time - reference)

    def boost(self, time: int, interval: int, maximum: int) -> int:
        return min(maximum, self.service_gap(time) // interval)

    @property
    def completed(self) -> bool:
        return self.remaining == 0


@dataclass
class HNWFResult:
    metrics: dict
    processes: list[dict]
    slices: list[dict]
    fairness_trace: list[dict]
    guard_events: list[dict]
    configuration: dict
    invariant_totals: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "metrics": self.metrics,
            "processes": self.processes,
            "slices": self.slices,
            "fairness_trace": self.fairness_trace,
            "guard_events": self.guard_events,
            "configuration": self.configuration,
        }
