"""Priority-to-nice mapping and fixed Linux-style weights for HNWF."""

from typing import Final


NICE_WEIGHTS: Final[dict[int, int]] = {
    -4: 2501,
    -3: 1991,
    -2: 1586,
    -1: 1277,
    0: 1024,
    1: 820,
    2: 655,
    3: 526,
    4: 423,
}


def nice_from_priority(priority: int) -> int:
    """Map the Phase 1 priority range 1..9 onto nice -4..+4."""
    if isinstance(priority, bool) or not isinstance(priority, int):
        raise ValueError("priority must be an integer from 1 through 9")
    if not 1 <= priority <= 9:
        raise ValueError("priority must be between 1 and 9")
    return priority - 5


def weight_from_priority(priority: int) -> int:
    """Return the authoritative fixed weight for a dataset priority."""
    return NICE_WEIGHTS[nice_from_priority(priority)]
