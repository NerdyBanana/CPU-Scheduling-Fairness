"""Round Robin (preemptive, fixed time quantum)."""
from collections import deque
import pandas as pd


def run_round_robin(df: pd.DataFrame, quantum: int = 4) -> pd.DataFrame:
    procs = df.copy().reset_index(drop=True)
    n = len(procs)
    remaining = procs["Burst_Time"].tolist()
    arrival = procs["Arrival_Time"].tolist()
    first_run = [None] * n
    completion = [None] * n

    order = sorted(range(n), key=lambda i: (arrival[i], procs.loc[i, "PID"]))
    time = arrival[order[0]]
    queue = deque()
    in_queue = [False] * n
    ptr = 0  # pointer into 'order' for not-yet-arrived processes

    # seed queue with anything arriving at time 0 (or first arrival time)
    while ptr < n and arrival[order[ptr]] <= time:
        queue.append(order[ptr]); in_queue[order[ptr]] = True
        ptr += 1

    completed = 0
    while completed < n:
        if not queue:
            time = arrival[order[ptr]]
            while ptr < n and arrival[order[ptr]] <= time:
                queue.append(order[ptr]); in_queue[order[ptr]] = True
                ptr += 1
            continue

        i = queue.popleft()
        if first_run[i] is None:
            first_run[i] = time
        run_time = min(quantum, remaining[i])
        time += run_time
        remaining[i] -= run_time

        # any new arrivals during this run join queue before the current process (if unfinished)
        while ptr < n and arrival[order[ptr]] <= time:
            queue.append(order[ptr]); in_queue[order[ptr]] = True
            ptr += 1

        if remaining[i] > 0:
            queue.append(i)
        else:
            completion[i] = time
            completed += 1

    rows = []
    for i in range(n):
        p = procs.loc[i]
        waiting = completion[i] - p["Arrival_Time"] - p["Burst_Time"]
        turnaround = completion[i] - p["Arrival_Time"]
        response = first_run[i] - p["Arrival_Time"]
        rows.append({
            "PID": p["PID"], "Arrival_Time": p["Arrival_Time"],
            "Burst_Time": p["Burst_Time"], "Priority": p["Priority"],
            "Start_Time": first_run[i], "Completion_Time": completion[i],
            "Waiting_Time": waiting, "Turnaround_Time": turnaround,
            "Response_Time": response,
        })
    return pd.DataFrame(rows)
