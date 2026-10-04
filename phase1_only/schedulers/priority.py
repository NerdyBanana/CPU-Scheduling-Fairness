"""Priority Scheduling (non-preemptive). Lower Priority number = higher priority."""
import pandas as pd


def run_priority(df: pd.DataFrame, priority_col: str = "Priority") -> pd.DataFrame:
    procs = df.copy().reset_index(drop=True)
    n = len(procs)
    done = [False] * n
    time = 0
    completed = 0
    rows = []

    while completed < n:
        idxs = [i for i in range(n) if not done[i] and procs.loc[i, "Arrival_Time"] <= time]
        if not idxs:
            time = procs.loc[[i for i in range(n) if not done[i]], "Arrival_Time"].min()
            continue
        idxs.sort(key=lambda i: (procs.loc[i, priority_col],
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
