"""SJF - Shortest Job First (non-preemptive) and SRTF (preemptive) variant."""
import pandas as pd


def run_sjf(df: pd.DataFrame) -> pd.DataFrame:
    """Non-preemptive: once started, a process runs to completion."""
    procs = df.copy().reset_index(drop=True)
    n = len(procs)
    done = [False] * n
    time = 0
    completed = 0
    rows = []

    while completed < n:
        # candidates: arrived and not done
        idxs = [i for i in range(n) if not done[i] and procs.loc[i, "Arrival_Time"] <= time]
        if not idxs:
            # jump to next arrival
            time = procs.loc[[i for i in range(n) if not done[i]], "Arrival_Time"].min()
            continue
        # pick shortest burst; tie -> earliest arrival -> PID
        idxs.sort(key=lambda i: (procs.loc[i, "Burst_Time"],
                                  procs.loc[i, "Arrival_Time"],
                                  procs.loc[i, "PID"]))
        i = idxs[0]
        p = procs.loc[i]
        start = max(time, p["Arrival_Time"])
        completion = start + p["Burst_Time"]
        waiting = start - p["Arrival_Time"]
        turnaround = completion - p["Arrival_Time"]
        response = start - p["Arrival_Time"]
        rows.append({
            "PID": p["PID"], "Arrival_Time": p["Arrival_Time"],
            "Burst_Time": p["Burst_Time"], "Priority": p["Priority"],
            "Start_Time": start, "Completion_Time": completion,
            "Waiting_Time": waiting, "Turnaround_Time": turnaround,
            "Response_Time": response,
        })
        time = completion
        done[i] = True
        completed += 1

    return pd.DataFrame(rows)


def run_srtf(df: pd.DataFrame) -> pd.DataFrame:
    """Preemptive: at every time unit, run whichever arrived process has
    the least remaining burst time. Simulated at unit-time granularity."""
    procs = df.copy().reset_index(drop=True)
    n = len(procs)
    remaining = procs["Burst_Time"].tolist()
    arrival = procs["Arrival_Time"].tolist()
    first_run = [None] * n
    completion = [None] * n

    time = 0
    completed = 0
    # safety cap to avoid infinite loop
    total_burst = sum(remaining)
    max_time_cap = max(arrival) + total_burst + 10

    while completed < n and time <= max_time_cap:
        idxs = [i for i in range(n) if arrival[i] <= time and remaining[i] > 0]
        if not idxs:
            time += 1
            continue
        idxs.sort(key=lambda i: (remaining[i], arrival[i], procs.loc[i, "PID"]))
        i = idxs[0]
        if first_run[i] is None:
            first_run[i] = time
        remaining[i] -= 1
        time += 1
        if remaining[i] == 0:
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
