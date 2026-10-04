"""Generates a Gantt-chart style visualization comparing all 4 baseline
schedulers on a single example workload -- useful as a figure in the report.
For preemptive algorithms (SRTF, RR) we track actual execution slices so the
chart correctly shows interruptions, not a single continuous bar."""
import matplotlib.pyplot as plt
import sys, os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from dataset_gen import generate_workload
from schedulers.fcfs import run_fcfs
from schedulers.sjf_srtf import run_sjf
from schedulers.priority import run_priority
from collections import deque
import pandas as pd


def slices_from_nonpreemptive(schedule_df):
    return [(row["PID"], row["Start_Time"], row["Completion_Time"]) for _, row in schedule_df.iterrows()]


def slices_srtf(df):
    procs = df.copy().reset_index(drop=True)
    n = len(procs)
    remaining = procs["Burst_Time"].tolist()
    arrival = procs["Arrival_Time"].tolist()
    time = 0
    completed = 0
    total_burst = sum(remaining)
    max_time_cap = max(arrival) + total_burst + 10
    slices = []
    current_pid, slice_start = None, None

    while completed < n and time <= max_time_cap:
        idxs = [i for i in range(n) if arrival[i] <= time and remaining[i] > 0]
        if not idxs:
            time += 1
            continue
        idxs.sort(key=lambda i: (remaining[i], arrival[i], procs.loc[i, "PID"]))
        i = idxs[0]
        pid = procs.loc[i, "PID"]
        if pid != current_pid:
            if current_pid is not None:
                slices.append((current_pid, slice_start, time))
            current_pid, slice_start = pid, time
        remaining[i] -= 1
        time += 1
        if remaining[i] == 0:
            completed += 1
    if current_pid is not None:
        slices.append((current_pid, slice_start, time))
    return slices


def slices_round_robin(df, quantum=3):
    procs = df.copy().reset_index(drop=True)
    n = len(procs)
    remaining = procs["Burst_Time"].tolist()
    arrival = procs["Arrival_Time"].tolist()
    order = sorted(range(n), key=lambda i: (arrival[i], procs.loc[i, "PID"]))
    time = arrival[order[0]]
    queue = deque()
    ptr = 0
    while ptr < n and arrival[order[ptr]] <= time:
        queue.append(order[ptr]); ptr += 1
    completed = 0
    slices = []
    while completed < n:
        if not queue:
            time = arrival[order[ptr]]
            while ptr < n and arrival[order[ptr]] <= time:
                queue.append(order[ptr]); ptr += 1
            continue
        i = queue.popleft()
        run_time = min(quantum, remaining[i])
        slices.append((procs.loc[i, "PID"], time, time + run_time))
        time += run_time
        remaining[i] -= run_time
        while ptr < n and arrival[order[ptr]] <= time:
            queue.append(order[ptr]); ptr += 1
        if remaining[i] > 0:
            queue.append(i)
        else:
            completed += 1
    return slices


def gantt_from_slices(ax, slices, title, color_map):
    for pid, start, end in slices:
        ax.barh(0, end - start, left=start, color=color_map[pid], edgecolor="black")
        if end - start >= 1:
            ax.text(start + (end - start) / 2, 0, pid, ha="center", va="center",
                    fontsize=7, color="white", fontweight="bold")
    ax.set_yticks([])
    ax.set_title(title, fontsize=10)
    ax.set_xlabel("Time")


def main():
    df = generate_workload(n=6, seed=1, kind="normal")
    colors = plt.cm.tab10.colors
    color_map = {pid: colors[i % 10] for i, pid in enumerate(sorted(df["PID"]))}

    panels = {
        "FCFS": slices_from_nonpreemptive(run_fcfs(df)),
        "SJF (non-preemptive)": slices_from_nonpreemptive(run_sjf(df)),
        "SRTF (preemptive)": slices_srtf(df),
        "Round Robin (q=3)": slices_round_robin(df, quantum=3),
        "Priority (non-preemptive)": slices_from_nonpreemptive(run_priority(df)),
    }

    fig, axes = plt.subplots(len(panels), 1, figsize=(12, 2 * len(panels)))
    for ax, (name, slices) in zip(axes, panels.items()):
        gantt_from_slices(ax, slices, name, color_map)

    plt.suptitle("Phase 1: Baseline Scheduling Algorithms -- Example Run", fontsize=13)
    plt.tight_layout()
    os.makedirs("results", exist_ok=True)
    plt.savefig("results/phase1_gantt_example.png", dpi=150)
    print("Saved results/phase1_gantt_example.png")


if __name__ == "__main__":
    main()
