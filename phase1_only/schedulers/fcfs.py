"""FCFS - First Come First Served (non-preemptive)."""
import pandas as pd


def run_fcfs(df: pd.DataFrame) -> pd.DataFrame:
    procs = df.sort_values(["Arrival_Time", "PID"]).reset_index(drop=True)
    time = 0
    rows = []
    for _, p in procs.iterrows():
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
    return pd.DataFrame(rows)
