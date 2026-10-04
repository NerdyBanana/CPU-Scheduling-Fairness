"""Performance and fairness metrics for a completed schedule."""
import numpy as np
import pandas as pd


def jains_fairness_index(values):
    values = np.asarray(values, dtype=float)
    if np.all(values == 0):
        return 1.0
    return (values.sum() ** 2) / (len(values) * np.sum(values ** 2))


def compute_metrics(schedule_df: pd.DataFrame) -> dict:
    n = len(schedule_df)
    total_time = schedule_df["Completion_Time"].max() - schedule_df["Arrival_Time"].min()
    total_burst = schedule_df["Burst_Time"].sum()

    avg_wait = schedule_df["Waiting_Time"].mean()
    avg_turnaround = schedule_df["Turnaround_Time"].mean()
    avg_response = schedule_df["Response_Time"].mean()
    throughput = n / total_time if total_time > 0 else 0
    cpu_utilization = min(1.0, total_burst / total_time) if total_time > 0 else 0

    wait_values = schedule_df["Waiting_Time"].values
    fairness_index = jains_fairness_index(wait_values)
    wait_std = schedule_df["Waiting_Time"].std()

    starvation_threshold = 2 * avg_wait if avg_wait > 0 else 0
    starvation_count = int((schedule_df["Waiting_Time"] > starvation_threshold).sum())

    return {
        "Avg_Waiting_Time": avg_wait,
        "Avg_Turnaround_Time": avg_turnaround,
        "Avg_Response_Time": avg_response,
        "Throughput": throughput,
        "CPU_Utilization": cpu_utilization,
        "Jains_Fairness_Index": fairness_index,
        "Waiting_Time_StdDev": wait_std,
        "Starvation_Count": starvation_count,
        "Max_Waiting_Time": schedule_df["Waiting_Time"].max(),
    }
