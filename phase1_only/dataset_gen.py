"""
dataset_gen.py
Generates synthetic CPU process workloads under 3 conditions:
  - normal  : balanced arrivals, moderate uniform bursts
  - skewed  : mix of many short + few very long bursts (stresses SJF/Priority fairness)
  - bursty  : clustered arrivals (stresses queue length / congestion)

Each process has: PID, Arrival_Time, Burst_Time, Priority (1=highest, 10=lowest)
"""

import numpy as np
import pandas as pd


def generate_workload(n=25, seed=0, kind="normal"):
    rng = np.random.default_rng(seed)
    pid = [f"P{i+1}" for i in range(n)]

    if kind == "normal":
        arrival = np.sort(rng.integers(0, 40, n))
        burst = rng.integers(5, 20, n)
        priority = rng.integers(1, 10, n)

    elif kind == "skewed":
        arrival = np.sort(rng.integers(0, 40, n))
        n_short = int(n * 0.7)
        n_long = n - n_short
        short = rng.integers(2, 8, n_short)
        long = rng.integers(40, 100, n_long)
        burst = np.concatenate([short, long])
        rng.shuffle(burst)
        # bias: long jobs tend to get lower (worse) priority -> stresses priority scheduling
        priority = np.where(burst > 30,
                             rng.integers(6, 10, n),
                             rng.integers(1, 6, n))

    elif kind == "bursty":
        half = n // 2
        arrival = np.concatenate([
            rng.integers(0, 5, half),          # first cluster
            rng.integers(30, 35, n - half)     # second cluster
        ])
        arrival = np.sort(arrival)
        burst = rng.integers(5, 30, n)
        priority = rng.integers(1, 10, n)

    else:
        raise ValueError(f"unknown workload kind: {kind}")

    df = pd.DataFrame({
        "PID": pid,
        "Arrival_Time": arrival.astype(int),
        "Burst_Time": burst.astype(int),
        "Priority": priority.astype(int),
    })
    return df.reset_index(drop=True)


def save_all_workloads(out_dir="data", n=25, n_seeds=10):
    """Generates and saves n_seeds instances of each workload kind."""
    import os
    os.makedirs(out_dir, exist_ok=True)
    kinds = ["normal", "skewed", "bursty"]
    manifest = []
    for kind in kinds:
        for seed in range(n_seeds):
            df = generate_workload(n=n, seed=seed, kind=kind)
            path = f"{out_dir}/{kind}_seed{seed}.csv"
            df.to_csv(path, index=False)
            manifest.append((kind, seed, path))
    return manifest


if __name__ == "__main__":
    m = save_all_workloads()
    print(f"Generated {len(m)} workload files in ./data/")
    # preview one of each
    for kind in ["normal", "skewed", "bursty"]:
        df = generate_workload(n=10, seed=0, kind=kind)
        print(f"\n--- {kind} (preview, n=10) ---")
        print(df)
