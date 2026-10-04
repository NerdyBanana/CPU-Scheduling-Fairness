"""
Phase 1: Baseline Implementation
Runs FCFS, SJF, SRTF, Round Robin, Priority across 3 workload types x N seeds.
Produces:
  - results/phase1_per_run.csv       (every run's metrics)
  - results/phase1_summary.csv       (mean +/- std per algorithm per workload)
  - results/phase1_summary.png       (comparison chart)
"""
import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from dataset_gen import generate_workload
from schedulers.fcfs import run_fcfs
from schedulers.sjf_srtf import run_sjf, run_srtf
from schedulers.round_robin import run_round_robin
from schedulers.priority import run_priority
from metrics import compute_metrics

WORKLOADS = ["normal", "skewed", "bursty"]
N_SEEDS = 10
N_PROCS = 25
QUANTUM = 4

ALGORITHMS = {
    "FCFS": run_fcfs,
    "SJF": run_sjf,
    "SRTF": run_srtf,
    "RR": lambda d: run_round_robin(d, quantum=QUANTUM),
    "Priority": run_priority,
}


def run_all():
    records = []
    for kind in WORKLOADS:
        for seed in range(N_SEEDS):
            df = generate_workload(n=N_PROCS, seed=seed, kind=kind)
            for algo_name, fn in ALGORITHMS.items():
                sched = fn(df)
                m = compute_metrics(sched)
                m.update({"Workload": kind, "Seed": seed, "Algorithm": algo_name})
                records.append(m)
    return pd.DataFrame(records)


def summarize(per_run: pd.DataFrame) -> pd.DataFrame:
    metric_cols = ["Avg_Waiting_Time", "Avg_Turnaround_Time", "Avg_Response_Time",
                   "Throughput", "CPU_Utilization", "Jains_Fairness_Index",
                   "Waiting_Time_StdDev", "Starvation_Count", "Max_Waiting_Time"]
    grouped = per_run.groupby(["Workload", "Algorithm"])[metric_cols]
    mean_df = grouped.mean().add_suffix("_mean")
    std_df = grouped.std().add_suffix("_std")
    summary = pd.concat([mean_df, std_df], axis=1).reset_index()
    return summary


def plot_summary(summary: pd.DataFrame, out_path: str):
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))
    metrics_to_plot = [
        ("Avg_Waiting_Time_mean", "Avg Waiting Time"),
        ("Jains_Fairness_Index_mean", "Jain's Fairness Index"),
        ("Starvation_Count_mean", "Avg Starvation Count"),
    ]
    algos = list(ALGORITHMS.keys())
    x = np.arange(len(WORKLOADS))
    width = 0.15

    for ax, (col, title) in zip(axes, metrics_to_plot):
        for i, algo in enumerate(algos):
            vals = [summary[(summary.Workload == w) & (summary.Algorithm == algo)][col].values[0]
                    for w in WORKLOADS]
            ax.bar(x + i * width, vals, width, label=algo)
        ax.set_xticks(x + width * (len(algos) - 1) / 2)
        ax.set_xticklabels(WORKLOADS)
        ax.set_title(title)
        ax.set_xlabel("Workload")
    axes[0].legend(loc="upper left", fontsize=8)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150)
    plt.close()


if __name__ == "__main__":
    os.makedirs("results", exist_ok=True)
    per_run = run_all()
    per_run.to_csv("results/phase1_per_run.csv", index=False)

    summary = summarize(per_run)
    summary.to_csv("results/phase1_summary.csv", index=False)

    plot_summary(summary, "results/phase1_summary.png")

    print("=== Phase 1 Summary (mean values) ===")
    display_cols = ["Workload", "Algorithm", "Avg_Waiting_Time_mean",
                     "Avg_Turnaround_Time_mean", "Jains_Fairness_Index_mean",
                     "Starvation_Count_mean"]
    print(summary[display_cols].round(2).to_string(index=False))
    print("\nSaved: results/phase1_per_run.csv, results/phase1_summary.csv, results/phase1_summary.png")
