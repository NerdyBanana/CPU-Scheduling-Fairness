"""Configuration model shared by the HNWF fairness supervisor."""

from dataclasses import asdict, dataclass

from .nice_weights import NICE_WEIGHTS


@dataclass(frozen=True)
class HNWFConfig:
    gmax: int = 32
    protected_quantum: int = 1
    boost_interval: int = 8
    max_boost: int = 4
    debt_epsilon: float = 0.25
    context_switch_cost: int = 0

    def __post_init__(self) -> None:
        integer_fields = {
            "gmax": self.gmax,
            "protected_quantum": self.protected_quantum,
            "boost_interval": self.boost_interval,
            "max_boost": self.max_boost,
            "context_switch_cost": self.context_switch_cost,
        }
        for name, value in integer_fields.items():
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"{name} must be an integer")
        if self.gmax < 1:
            raise ValueError("gmax must be at least 1")
        if not 1 <= self.protected_quantum <= self.gmax:
            raise ValueError("protected_quantum must be between 1 and gmax")
        if self.boost_interval < 1:
            raise ValueError("boost_interval must be at least 1")
        if self.max_boost < 0:
            raise ValueError("max_boost cannot be negative")
        if isinstance(self.debt_epsilon, bool) or not isinstance(self.debt_epsilon, (int, float)):
            raise ValueError("debt_epsilon must be numeric")
        if self.debt_epsilon < 0:
            raise ValueError("debt_epsilon cannot be negative")
        if self.context_switch_cost < 0:
            raise ValueError("context_switch_cost cannot be negative")

    def to_dict(self) -> dict:
        values = asdict(self)
        values.update(
            {
                "policy": "HNWF",
                "policy_version": "1.0.0",
                "nice_mapping": "priority_minus_5",
                "nice_weights": {str(k): v for k, v in NICE_WEIGHTS.items()},
            }
        )
        return values
