"""
app.py - CPU Scheduling Analyzer (Phase 1 Baseline UI)

A Streamlit web dashboard built on top of the Phase 1 CPU scheduling engine.
Visualizes baseline performance, Jain's Fairness Index, starvation analysis,
and interactive Gantt execution timelines using Plotly.

Strictly preserves core scheduling and metrics logic without modification.
"""

import os
import sys
import numpy as np
import pandas as pd
import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# Add phase1 directory to path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.append(BASE_DIR)

# Import existing core engine components - DO NOT REWRITE OR MODIFY
from dataset_gen import generate_workload
from schedulers.fcfs import run_fcfs
from schedulers.sjf_srtf import run_sjf, run_srtf
from schedulers.round_robin import run_round_robin
from schedulers.priority import run_priority
from metrics import compute_metrics, jains_fairness_index
from plot_gantt_example import slices_from_nonpreemptive, slices_srtf, slices_round_robin
import main_phase1


# ---------------------------------------------------------
# Page Configuration & Styling
# ---------------------------------------------------------
st.set_page_config(
    page_title="CPU Scheduling Analyzer | Phase 1 Baseline",
    page_icon="⚙️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for academic, polished styling
st.markdown("""
<style>
    .main-title {
        font-size: 2.2rem;
        font-weight: 700;
        color: #1E293B;
        margin-bottom: 0.2rem;
    }
    .sub-title {
        font-size: 1.05rem;
        color: #475569;
        margin-bottom: 1.2rem;
    }
    .metric-card {
        background-color: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .stTabs [data-baseweb="tab-list"] {
        gap: 8px;
    }
    .stTabs [data-baseweb="tab"] {
        height: 45px;
        padding-left: 16px;
        padding-right: 16px;
        border-radius: 6px 6px 0 0;
        font-weight: 600;
    }
    .phase2-banner {
        background-color: #F0FDF4;
        border-left: 4px solid #16A34A;
        padding: 12px 16px;
        border-radius: 4px;
        margin-bottom: 1rem;
        font-size: 0.92rem;
        color: #166534;
    }
</style>
""", unsafe_allow_html=True)


# ---------------------------------------------------------
# Simulation Helper Functions
# ---------------------------------------------------------
def get_algorithm_runners(quantum: int):
    """Returns mapping of algorithm names to their runner functions."""
    return {
        "FCFS": run_fcfs,
        "SJF": run_sjf,
        "SRTF": run_srtf,
        "RR": lambda d: run_round_robin(d, quantum=quantum),
        "Priority": run_priority,
    }


def execute_simulation(df: pd.DataFrame, selected_algos: list, quantum: int):
    """
    Executes selected algorithms and computes metrics using the unchanged
    metrics.py and scheduler modules.
    """
    runners = get_algorithm_runners(quantum)
    schedules = {}
    metrics_records = []
    per_process_dfs = {}

    for algo in selected_algos:
        if algo not in runners:
            continue
        sched_df = runners[algo](df.copy())
        schedules[algo] = sched_df

        # Use unchanged compute_metrics from metrics.py
        m = compute_metrics(sched_df)
        m["Algorithm"] = algo
        metrics_records.append(m)

        # Build detailed per-process table with exact starvation rule
        avg_wait = m["Avg_Waiting_Time"]
        # Starvation rule from metrics.py line 28:
        # starvation_threshold = 2 * avg_wait if avg_wait > 0 else 0
        starve_thresh = 2.0 * avg_wait if avg_wait > 0 else 0.0

        p_df = sched_df.copy()
        p_df["Algorithm"] = algo
        p_df["Starvation_Threshold"] = starve_thresh
        p_df["Starved"] = p_df["Waiting_Time"] > starve_thresh
        per_process_dfs[algo] = p_df

    summary_df = pd.DataFrame(metrics_records)
    return schedules, summary_df, per_process_dfs


def get_gantt_slices(df: pd.DataFrame, schedules: dict, quantum: int):
    """
    Extracts exact timeline execution slices for Plotly Gantt rendering.
    Uses unchanged slice functions from plot_gantt_example.py.
    """
    all_slices = {}
    for algo, sched_df in schedules.items():
        if algo == "FCFS":
            all_slices[algo] = slices_from_nonpreemptive(sched_df)
        elif algo == "SJF":
            all_slices[algo] = slices_from_nonpreemptive(sched_df)
        elif algo == "SRTF":
            all_slices[algo] = slices_srtf(df)
        elif algo == "RR":
            all_slices[algo] = slices_round_robin(df, quantum=quantum)
        elif algo == "Priority":
            all_slices[algo] = slices_from_nonpreemptive(sched_df)
    return all_slices


# ---------------------------------------------------------
# Sidebar Controls
# ---------------------------------------------------------
st.sidebar.title("Simulation Controls")

# Workload Selection
st.sidebar.subheader("1. Workload Configuration")
workload_type = st.sidebar.selectbox(
    "Workload Type",
    ["normal", "skewed", "bursty"],
    index=0,
    help=(
        "Normal: Balanced arrivals & bursts\n"
        "Skewed: Many short jobs + few long jobs (stresses SJF/Priority fairness)\n"
        "Bursty: Clustered arrivals (stresses queue congestion)"
    )
)

data_source = st.sidebar.radio(
    "Dataset Source",
    ["Pre-generated File (data/)", "Generate New Dataset", "Upload Custom CSV"],
    index=0
)

active_df = None

if data_source == "Pre-generated File (data/)":
    seed_idx = st.sidebar.slider("Workload Seed", min_value=0, max_value=9, value=0)
    file_path = os.path.join(BASE_DIR, "data", f"{workload_type}_seed{seed_idx}.csv")
    if os.path.exists(file_path):
        active_df = pd.read_csv(file_path)
    else:
        # Fallback to generator if file doesn't exist
        active_df = generate_workload(n=25, seed=seed_idx, kind=workload_type)

elif data_source == "Generate New Dataset":
    num_procs = st.sidebar.slider("Number of Processes (N)", min_value=5, max_value=50, value=25, step=5)
    custom_seed = st.sidebar.number_input("Random Seed", min_value=0, max_value=9999, value=42)
    active_df = generate_workload(n=num_procs, seed=custom_seed, kind=workload_type)

elif data_source == "Upload Custom CSV":
    uploaded_file = st.sidebar.file_uploader("Upload Workload CSV", type=["csv"])
    if uploaded_file is not None:
        try:
            custom_df = pd.read_csv(uploaded_file)
            req_cols = {"PID", "Arrival_Time", "Burst_Time", "Priority"}
            if req_cols.issubset(custom_df.columns):
                active_df = custom_df.copy()
            else:
                st.sidebar.error(f"CSV must contain: {req_cols}")
        except Exception as e:
            st.sidebar.error(f"Error reading CSV: {e}")

# Default fallback if needed
if active_df is None:
    active_df = generate_workload(n=25, seed=0, kind="normal")

# Round Robin Quantum
st.sidebar.subheader("2. Scheduler Parameters")
rr_quantum = st.sidebar.number_input(
    "Round Robin Time Quantum (q)",
    min_value=1,
    max_value=25,
    value=4,
    step=1,
    help="Time slice allocated to each process per Round Robin turn."
)

# Algorithm Selection
st.sidebar.subheader("3. Algorithms")
available_algos = ["FCFS", "SJF", "SRTF", "RR", "Priority"]
all_selected = st.sidebar.checkbox("Select All Algorithms", value=True)

if all_selected:
    selected_algos = available_algos
else:
    selected_algos = st.sidebar.multiselect(
        "Choose Algorithms to Compare",
        options=available_algos,
        default=available_algos
    )

if not selected_algos:
    selected_algos = ["FCFS"]
    st.sidebar.warning("At least one algorithm must be selected. Selected FCFS as default.")

# Run Actions
st.sidebar.subheader("4. Execution")
run_sim_btn = st.sidebar.button("▶ Run Simulation", type="primary", use_container_width=True)
run_batch_btn = st.sidebar.button("🔄 Run Full Batch Experiment (150 runs)", use_container_width=True)

if run_batch_btn:
    with st.spinner("Running full batch experiment across all 3 workloads and 10 seeds..."):
        per_run_df = main_phase1.run_all()
        per_run_df.to_csv(os.path.join(BASE_DIR, "results", "phase1_per_run.csv"), index=False)
        summary_df_batch = main_phase1.summarize(per_run_df)
        summary_df_batch.to_csv(os.path.join(BASE_DIR, "results", "phase1_summary.csv"), index=False)
        main_phase1.plot_summary(summary_df_batch, os.path.join(BASE_DIR, "results", "phase1_summary.png"))
        st.sidebar.success("Batch experiment complete! Results CSVs and charts updated.")


# ---------------------------------------------------------
# Run Active Simulation
# ---------------------------------------------------------
schedules, summary_metrics, per_process_dfs = execute_simulation(
    active_df, selected_algos, rr_quantum
)
gantt_slices = get_gantt_slices(active_df, schedules, rr_quantum)


# ---------------------------------------------------------
# Main Page Header
# ---------------------------------------------------------
st.markdown('<div class="main-title">CPU Scheduling Analyzer</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-title">Phase 1 — Baseline Fairness & Performance Analysis | '
    'Compare classical CPU scheduling algorithms under diverse workloads.</div>',
    unsafe_allow_html=True
)

st.markdown("""
<div class="phase2-banner">
    <strong>Phase 1 Scope:</strong> Evaluates classical deterministic algorithms (FCFS, SJF, SRTF, RR, Priority)
    and quantifies trade-offs between turnaround efficiency and allocation fairness.
    <em>Adaptive ML-based starvation mitigation will be integrated in Phase 2.</em>
</div>
""", unsafe_allow_html=True)


# ---------------------------------------------------------
# Top KPI Metric Cards
# ---------------------------------------------------------
kpi1, kpi2, kpi3, kpi4, kpi5 = st.columns(5)

# Best waiting time
best_wait_row = summary_metrics.loc[summary_metrics["Avg_Waiting_Time"].idxmin()]
# Best fairness
best_fair_row = summary_metrics.loc[summary_metrics["Jains_Fairness_Index"].idxmax()]
# Lowest starvation
best_starve_row = summary_metrics.loc[summary_metrics["Starvation_Count"].idxmin()]

kpi1.metric(
    label="⚡ Best Avg Waiting Time",
    value=f"{best_wait_row['Avg_Waiting_Time']:.2f}",
    delta=f"{best_wait_row['Algorithm']}"
)

kpi2.metric(
    label="⚖️ Highest Fairness Index",
    value=f"{best_fair_row['Jains_Fairness_Index']:.4f}",
    delta=f"{best_fair_row['Algorithm']}"
)

kpi3.metric(
    label="🛡️ Lowest Starvation",
    value=f"{int(best_starve_row['Starvation_Count'])} procs",
    delta=f"{best_starve_row['Algorithm']}"
)

kpi4.metric(
    label="📦 Workload Size",
    value=f"{len(active_df)} Processes",
    delta=f"Type: {workload_type.capitalize()}",
    delta_color="off"
)

kpi5.metric(
    label="⏱️ RR Quantum",
    value=f"q = {rr_quantum}",
    delta="Configured",
    delta_color="off"
)

st.markdown("---")


# ---------------------------------------------------------
# Tabbed Navigation Layout
# ---------------------------------------------------------
tabs = st.tabs([
    "📊 Performance & Fairness Dashboard",
    "📈 Interactive Plotly Gantt Chart",
    "📋 Per-Process Execution Details",
    "🌐 Multi-Workload Benchmark",
    "📖 Metrics & Methodology"
])


# =========================================================
# TAB 1: Performance & Fairness Dashboard
# =========================================================
with tabs[0]:
    st.subheader("Comparative Performance & Fairness Analysis")

    col_charts_left, col_charts_right = st.columns(2)

    palette = px.colors.qualitative.Plotly
    algo_color_map = {
        "FCFS": "#636EFA",
        "SJF": "#EF553B",
        "SRTF": "#00CC96",
        "RR": "#AB63FA",
        "Priority": "#FFA15A"
    }

    with col_charts_left:
        # Chart 1: Average Waiting Time
        fig_wait = px.bar(
            summary_metrics,
            x="Algorithm",
            y="Avg_Waiting_Time",
            color="Algorithm",
            color_discrete_map=algo_color_map,
            title="<b>Average Waiting Time</b> (Lower is Better)",
            labels={"Avg_Waiting_Time": "Avg Waiting Time (time units)"},
            text=summary_metrics["Avg_Waiting_Time"].apply(lambda v: f"{v:.2f}")
        )
        fig_wait.update_traces(textposition="outside")
        fig_wait.update_layout(showlegend=False, height=350, margin=dict(l=20, r=20, t=50, b=20))
        st.plotly_chart(fig_wait, use_container_width=True)

        # Chart 2: Average Turnaround Time
        fig_tat = px.bar(
            summary_metrics,
            x="Algorithm",
            y="Avg_Turnaround_Time",
            color="Algorithm",
            color_discrete_map=algo_color_map,
            title="<b>Average Turnaround Time</b> (Lower is Better)",
            labels={"Avg_Turnaround_Time": "Avg Turnaround Time"},
            text=summary_metrics["Avg_Turnaround_Time"].apply(lambda v: f"{v:.2f}")
        )
        fig_tat.update_traces(textposition="outside")
        fig_tat.update_layout(showlegend=False, height=350, margin=dict(l=20, r=20, t=50, b=20))
        st.plotly_chart(fig_tat, use_container_width=True)

    with col_charts_right:
        # Chart 3: Jain's Fairness Index
        fig_fair = px.bar(
            summary_metrics,
            x="Algorithm",
            y="Jains_Fairness_Index",
            color="Algorithm",
            color_discrete_map=algo_color_map,
            title="<b>Jain's Fairness Index</b> (Higher is Better, Scale: 0.0 – 1.0)",
            labels={"Jains_Fairness_Index": "Jain's Index"},
            text=summary_metrics["Jains_Fairness_Index"].apply(lambda v: f"{v:.4f}")
        )
        fig_fair.update_traces(textposition="outside")
        fig_fair.update_layout(yaxis_range=[0, 1.05], showlegend=False, height=350, margin=dict(l=20, r=20, t=50, b=20))
        st.plotly_chart(fig_fair, use_container_width=True)

        # Chart 4: Starvation Count
        fig_starve = px.bar(
            summary_metrics,
            x="Algorithm",
            y="Starvation_Count",
            color="Algorithm",
            color_discrete_map=algo_color_map,
            title="<b>Starvation Count</b> (Waiting Time > 2× Avg Wait, Lower is Better)",
            labels={"Starvation_Count": "Starved Processes"},
            text=summary_metrics["Starvation_Count"].astype(int)
        )
        fig_starve.update_traces(textposition="outside")
        fig_starve.update_layout(showlegend=False, height=350, margin=dict(l=20, r=20, t=50, b=20))
        st.plotly_chart(fig_starve, use_container_width=True)

    # Response Time Chart
    fig_resp = px.bar(
        summary_metrics,
        x="Algorithm",
        y="Avg_Response_Time",
        color="Algorithm",
        color_discrete_map=algo_color_map,
        title="<b>Average Response Time</b> (Time to First CPU Acquisition, Lower is Better)",
        labels={"Avg_Response_Time": "Avg Response Time"},
        text=summary_metrics["Avg_Response_Time"].apply(lambda v: f"{v:.2f}")
    )
    fig_resp.update_traces(textposition="outside")
    fig_resp.update_layout(showlegend=False, height=320, margin=dict(l=20, r=20, t=50, b=20))
    st.plotly_chart(fig_resp, use_container_width=True)

    # Full Numerical Summary Table
    st.subheader("Numerical Summary Table")
    display_summary = summary_metrics[[
        "Algorithm", "Avg_Waiting_Time", "Avg_Turnaround_Time", "Avg_Response_Time",
        "Throughput", "CPU_Utilization", "Jains_Fairness_Index", "Waiting_Time_StdDev",
        "Starvation_Count", "Max_Waiting_Time"
    ]].copy()

    st.dataframe(
        display_summary.style.format({
            "Avg_Waiting_Time": "{:.2f}",
            "Avg_Turnaround_Time": "{:.2f}",
            "Avg_Response_Time": "{:.2f}",
            "Throughput": "{:.4f}",
            "CPU_Utilization": "{:.1%}",
            "Jains_Fairness_Index": "{:.4f}",
            "Waiting_Time_StdDev": "{:.2f}",
            "Starvation_Count": "{:.0f}",
            "Max_Waiting_Time": "{:.0f}",
        }),
        use_container_width=True
    )

    # Dynamic Fairness & Trade-off Analysis Narrative
    st.subheader("Fairness & Starvation Analytical Insights")
    min_wait_algo = best_wait_row["Algorithm"]
    max_fair_algo = best_fair_row["Algorithm"]
    min_starve_algo = best_starve_row["Algorithm"]

    st.info(f"""
    **Key Observations for Workload `{workload_type.upper()}`:**
    - **Throughput & Efficiency Leader:** **{min_wait_algo}** achieved the lowest average waiting time ({best_wait_row['Avg_Waiting_Time']:.2f} time units). SJF and SRTF greedily schedule shorter jobs first, maximizing immediate completion rates.
    - **Fairness & Equal Access Leader:** **{max_fair_algo}** delivered the highest Jain's Fairness Index ({best_fair_row['Jains_Fairness_Index']:.4f}). Round Robin enforces time-sliced access so all active processes progress concurrently.
    - **Starvation Risk Profile:** **{min_starve_algo}** minimized the starvation count ({int(best_starve_row['Starvation_Count'])} starved jobs). In contrast, priority-based and shortest-job schemes tend to delay longer or lower-priority processes when the queue is saturated.
    - **Trade-Off Conclusion:** No single baseline algorithm dominates both efficiency and fairness simultaneously. This fundamental trade-off motivates the fairness-aware adaptive mechanism in Phase 2.
    """)

    # Active Workload Dataset Table Preview
    with st.expander("🔍 Inspect Active Workload Dataset", expanded=False):
        st.write(f"Showing {len(active_df)} processes in current dataset:")
        st.dataframe(active_df, use_container_width=True)


# =========================================================
# TAB 2: Interactive Plotly Gantt Chart
# =========================================================
with tabs[1]:
    st.subheader("Interactive Process Execution Timeline (Plotly Gantt)")
    st.write(
        "Explore process execution intervals, preemptive context switches, and CPU idle intervals. "
        "Hover over any block to view process details, or use the mode selector below."
    )

    gantt_view_mode = st.radio(
        "Gantt View Mode",
        ["Stacked Multi-Algorithm Comparison", "Single Algorithm Detailed Inspection"],
        horizontal=True
    )

    # Color palette for processes
    unique_pids = sorted(
        active_df["PID"].unique(),
        key=lambda x: int(x[1:]) if x[1:].isdigit() else x
    )
    discrete_colors = px.colors.qualitative.Dark24 + px.colors.qualitative.Alphabet
    pid_color_map = {pid: discrete_colors[i % len(discrete_colors)] for i, pid in enumerate(unique_pids)}

    if gantt_view_mode == "Stacked Multi-Algorithm Comparison":
        fig_gantt = go.Figure()
        legend_tracked = set()

        for algo in selected_algos:
            slices = gantt_slices.get(algo, [])
            for pid, start, end in slices:
                dur = end - start
                is_first = pid not in legend_tracked
                if is_first:
                    legend_tracked.add(pid)

                # Get process metadata
                p_meta = active_df[active_df["PID"] == pid].iloc[0]

                fig_gantt.add_trace(go.Bar(
                    y=[algo],
                    x=[dur],
                    base=[start],
                    orientation="h",
                    name=pid,
                    legendgroup=pid,
                    showlegend=is_first,
                    text=pid if dur >= (active_df["Burst_Time"].max() * 0.04) else "",
                    textposition="inside",
                    marker=dict(
                        color=pid_color_map.get(pid, "#999"),
                        line=dict(color="#1E293B", width=0.8)
                    ),
                    hovertemplate=(
                        f"<b>Algorithm: {algo}</b><br>"
                        f"Process: <b>{pid}</b><br>"
                        f"Execution: [{start} → {end}]<br>"
                        f"Slice Duration: {dur}<br>"
                        f"Total Burst: {p_meta['Burst_Time']}<br>"
                        f"Arrival Time: {p_meta['Arrival_Time']}<br>"
                        f"Priority: {p_meta['Priority']}"
                        "<extra></extra>"
                    )
                ))

        fig_gantt.update_layout(
            barmode="stack",
            xaxis_title="Simulation Time Units",
            yaxis_title="Algorithm",
            height=120 + 80 * len(selected_algos),
            xaxis=dict(showgrid=True, zeroline=True),
            yaxis=dict(autorange="reversed"),
            legend=dict(
                title="Process ID",
                orientation="h",
                yanchor="bottom",
                y=-0.35,
                xanchor="center",
                x=0.5
            ),
            margin=dict(l=40, r=40, t=30, b=80)
        )
        st.plotly_chart(fig_gantt, use_container_width=True)

    else:
        # Single Algorithm Detailed Inspection
        single_algo = st.selectbox("Select Algorithm for Detailed View", selected_algos, index=0)
        slices = gantt_slices.get(single_algo, [])
        sched_df = schedules.get(single_algo, pd.DataFrame())

        # Build detailed timeline where y-axis has process IDs
        fig_single = go.Figure()

        # Add arrival markers
        for _, row in active_df.iterrows():
            fig_single.add_trace(go.Scatter(
                x=[row["Arrival_Time"]],
                y=[row["PID"]],
                mode="markers",
                marker=dict(symbol="triangle-right", size=10, color="#2563EB"),
                name="Arrival Time",
                showlegend=False,
                hovertemplate=f"<b>{row['PID']} Arrived</b> at t={row['Arrival_Time']}<extra></extra>"
            ))

        # Add execution bars per PID
        for pid, start, end in slices:
            dur = end - start
            fig_single.add_trace(go.Bar(
                y=[pid],
                x=[dur],
                base=[start],
                orientation="h",
                name=pid,
                showlegend=False,
                text=f"{dur}",
                textposition="inside",
                marker=dict(
                    color=pid_color_map.get(pid, "#999"),
                    line=dict(color="#0F172A", width=1)
                ),
                hovertemplate=(
                    f"Process: <b>{pid}</b><br>"
                    f"Slice: [{start} → {end}]<br>"
                    f"Duration: {dur} units"
                    "<extra></extra>"
                )
            ))

        fig_single.update_layout(
            barmode="stack",
            title=f"<b>{single_algo} Execution Intervals by Process</b> (Blue markers indicate Arrival Time)",
            xaxis_title="Simulation Time Units",
            yaxis_title="Process ID",
            height=max(400, 25 * len(unique_pids)),
            yaxis=dict(
                categoryorder="array",
                categoryarray=list(reversed(unique_pids))
            ),
            margin=dict(l=40, r=40, t=50, b=40)
        )
        st.plotly_chart(fig_single, use_container_width=True)


# =========================================================
# TAB 3: Per-Process Execution Details
# =========================================================
with tabs[2]:
    st.subheader("Process-Level Results & Starvation Audit")

    detail_algo = st.selectbox("Filter by Algorithm", selected_algos, key="detail_algo_select")
    algo_proc_df = per_process_dfs.get(detail_algo, pd.DataFrame()).copy()

    if not algo_proc_df.empty:
        # Display Starvation Definition Alert
        avg_wait = algo_proc_df["Waiting_Time"].mean()
        starve_threshold = 2.0 * avg_wait if avg_wait > 0 else 0.0
        num_starved = int(algo_proc_df["Starved"].sum())

        st.markdown(f"""
        > **Starvation Criterion in `metrics.py`:**
        > A process is classified as **Starved** if its Waiting Time exceeds **2 × Average Waiting Time**.
        > - **Current Average Waiting Time:** `{avg_wait:.2f}` time units
        > - **Current Starvation Threshold:** `{starve_threshold:.2f}` time units
        > - **Classified Starved Processes:** `{num_starved}` of `{len(algo_proc_df)}`
        """)

        # Highlight starved processes
        def highlight_starved(row):
            if row["Starved"]:
                return ["background-color: #FEE2E2; color: #991B1B; font-weight: bold;"] * len(row)
            return [""] * len(row)

        display_cols = [
            "PID", "Arrival_Time", "Burst_Time", "Priority",
            "Start_Time", "Completion_Time", "Waiting_Time",
            "Turnaround_Time", "Response_Time", "Starved"
        ]

        formatted_df = algo_proc_df[display_cols].sort_values("Waiting_Time", ascending=False)
        st.dataframe(
            formatted_df.style.apply(highlight_starved, axis=1).format({
                "Waiting_Time": "{:.1f}",
                "Turnaround_Time": "{:.1f}",
                "Response_Time": "{:.1f}",
            }),
            use_container_width=True,
            height=450
        )

        csv_data = formatted_df.to_csv(index=False).encode("utf-8")
        st.download_button(
            label=f"📥 Download {detail_algo} Process Metrics CSV",
            data=csv_data,
            file_name=f"{workload_type}_{detail_algo}_process_metrics.csv",
            mime="text/csv"
        )


# =========================================================
# TAB 4: Multi-Workload Benchmark
# =========================================================
with tabs[3]:
    st.subheader("Cross-Workload Baseline Comparison")
    st.write(
        "Analysis across all 3 standard workloads (Normal, Skewed, Bursty) evaluated "
        "across 10 Monte Carlo seeds (mean ± standard deviation)."
    )

    summary_file_path = os.path.join(BASE_DIR, "results", "phase1_summary.csv")

    if os.path.exists(summary_file_path):
        batch_summary = pd.read_csv(summary_file_path)

        # Workload vs Waiting Time
        fig_b_wait = px.bar(
            batch_summary,
            x="Workload",
            y="Avg_Waiting_Time_mean",
            color="Algorithm",
            barmode="group",
            color_discrete_map=algo_color_map,
            error_y="Avg_Waiting_Time_std",
            title="<b>Average Waiting Time Across Workload Distributions</b> (Lower is Better)",
            labels={"Avg_Waiting_Time_mean": "Mean Waiting Time (with std dev)"}
        )
        fig_b_wait.update_layout(height=380)
        st.plotly_chart(fig_b_wait, use_container_width=True)

        col_b_left, col_b_right = st.columns(2)
        with col_b_left:
            # Workload vs Fairness
            fig_b_fair = px.bar(
                batch_summary,
                x="Workload",
                y="Jains_Fairness_Index_mean",
                color="Algorithm",
                barmode="group",
                color_discrete_map=algo_color_map,
                error_y="Jains_Fairness_Index_std",
                title="<b>Jain's Fairness Index by Workload</b> (Higher is Better)",
                labels={"Jains_Fairness_Index_mean": "Mean Fairness Index"}
            )
            fig_b_fair.update_layout(height=360, yaxis_range=[0, 1.05])
            st.plotly_chart(fig_b_fair, use_container_width=True)

        with col_b_right:
            # Workload vs Starvation
            fig_b_starve = px.bar(
                batch_summary,
                x="Workload",
                y="Starvation_Count_mean",
                color="Algorithm",
                barmode="group",
                color_discrete_map=algo_color_map,
                error_y="Starvation_Count_std",
                title="<b>Avg Starvation Count by Workload</b> (Lower is Better)",
                labels={"Starvation_Count_mean": "Mean Starvation Count"}
            )
            fig_b_starve.update_layout(height=360)
            st.plotly_chart(fig_b_starve, use_container_width=True)

        # Batch summary table
        st.subheader("Batch Experiment Summary Table (`phase1_summary.csv`)")
        st.dataframe(batch_summary, use_container_width=True)

    else:
        st.warning("No summary data found at `results/phase1_summary.csv`. Click 'Run Full Batch Experiment' in the sidebar.")


# =========================================================
# TAB 5: Metrics & Methodology
# =========================================================
with tabs[4]:
    st.subheader("Mathematical Formulations & Methodology")

    st.markdown(r"""
    ### 1. Performance Metrics
    - **Waiting Time ($W_i$):** Total duration process $i$ spends in the ready queue before completion.
      $$W_i = \text{Completion}_i - \text{Arrival}_i - \text{Burst}_i$$
    - **Turnaround Time ($\text{TAT}_i$):** Total elapsed time from arrival to full completion.
      $$\text{TAT}_i = \text{Completion}_i - \text{Arrival}_i = W_i + \text{Burst}_i$$
    - **Response Time ($R_i$):** Delay from arrival until the process first executes on the CPU.
      $$R_i = \text{Start}_i - \text{Arrival}_i$$
    - **System Throughput ($X$):** Completed processes per unit time over the active simulation interval.
      $$X = \frac{n}{\max_i(\text{Completion}_i) - \min_i(\text{Arrival}_i)}$$
    - **CPU Utilization ($U$):** Ratio of busy CPU cycles to total elapsed span.
      $$U = \min\left(1.0, \frac{\sum_{i=1}^n \text{Burst}_i}{\max_i(\text{Completion}_i) - \min_i(\text{Arrival}_i)}\right)$$

    ---

    ### 2. Jain's Fairness Index
    As defined in `metrics.py`, Jain's Fairness Index ($J$) evaluates how uniformly waiting delays are distributed among all processes:
    $$J = \frac{\left(\sum_{i=1}^n W_i\right)^2}{n \sum_{i=1}^n W_i^2}$$
    - **Range:** $J \in [0, 1]$
    - **Interpretation:** $1.0$ represents absolute equality (identical waiting times across all processes). Values below $0.5$ indicate severe disparities.

    ---

    ### 3. Starvation Definition
    To objectively capture starvation without arbitrary bias, the Phase 1 engine implements:
    $$\text{Threshold} = 2 \times \bar{W} = 2 \times \left(\frac{1}{n} \sum_{i=1}^n W_i\right)$$
    $$\text{Starved}(i) = \begin{cases} 1 & \text{if } W_i > \text{Threshold} \\ 0 & \text{otherwise} \end{cases}$$
    A process is classified as starved if its individual waiting time exceeds twice the schedule's mean waiting time.

    ---

    ### 4. Scheduler Operating Characteristics
    | Algorithm | Preemptive? | Scheduling Criterion | Known Vulnerability |
    | :--- | :--- | :--- | :--- |
    | **FCFS** | Non-preemptive | Earliest Arrival Time | Convoy effect behind long jobs |
    | **SJF** | Non-preemptive | Shortest Burst Time | Starvation of long bursts under continuous arrivals |
    | **SRTF** | Preemptive | Least Remaining Burst Time | Frequent context switches; starvation of long jobs |
    | **Round Robin** | Preemptive | FIFO order with Quantum ($q$) | Higher turnaround times if quantum is suboptimal |
    | **Priority** | Non-preemptive | Numerical Priority (1 = Highest) | Starvation of low-priority processes |
    """)
