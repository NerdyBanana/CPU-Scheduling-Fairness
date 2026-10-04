# Phase 1 – Baseline CPU Scheduling Implementation

Implements and compares four classical CPU scheduling algorithms:
**FCFS, SJF/SRTF, Round Robin, and Priority Scheduling.**

## Structure

```
phase1_only/
├── app.py                  # Streamlit web dashboard (interactive Plotly charts & Gantt)
├── dataset_gen.py          # generates process dataset: PID, Arrival_Time, Burst_Time, Priority
│                           #   (3 workload types: normal, skewed, bursty)
├── metrics.py              # waiting/turnaround/response time, throughput, CPU utilization,
│                           #   Jain's Fairness Index, starvation count
├── schedulers/
│   ├── fcfs.py             # First Come First Served (non-preemptive)
│   ├── sjf_srtf.py         # Shortest Job First (non-preemptive) + SRTF (preemptive)
│   ├── round_robin.py      # Round Robin (fixed time quantum)
│   └── priority.py         # Priority Scheduling (non-preemptive)
├── main_phase1.py          # runs all algorithms across all workloads/seeds, saves results
├── plot_gantt_example.py   # generates a Gantt-chart figure for one example run
├── requirements.txt        # dependencies (streamlit, plotly, pandas, numpy, matplotlib)
├── data/                   # generated workload CSVs (created when you run dataset_gen.py)
└── results/                # output CSVs and charts (created when you run main_phase1.py)
```

## How to Run

### Interactive Streamlit Dashboard (UI Mode)
```bash
streamlit run app.py
```

### Command-Line Execution (CLI / Terminal Mode)
```bash
python dataset_gen.py            # 1. generate the process datasets
python main_phase1.py            # 2. run all algorithms, save summary table + chart
python plot_gantt_example.py     # 3. (optional) generate the Gantt chart figure
```

## Outputs

- `results/phase1_per_run.csv` — every individual simulation run's metrics
- `results/phase1_summary.csv` — mean and std dev per (workload x algorithm)
- `results/phase1_summary.png` — bar chart comparing all 4 algorithms
- `results/phase1_gantt_example.png` — Gantt chart of one example run (all 4 algorithms)

## Dataset

Each process has 4 fields: `PID, Arrival_Time, Burst_Time, Priority` (1 = highest priority).
Three workload types are generated:
- **normal**: balanced, evenly distributed arrivals and burst times
- **skewed**: mostly short jobs + a few very long jobs (stresses SJF/Priority fairness)
- **bursty**: clustered arrival times (stresses queue length / congestion)

## Notes

- FCFS and Priority are non-preemptive: once a process starts, it runs to completion.
- SJF is non-preemptive; SRTF is its preemptive counterpart (can switch to a newly
  arrived shorter job mid-execution).
- Round Robin uses a fixed time quantum (default = 4) and cycles through the ready queue.
- This package is fully standalone — no dependency on any ML/fairness-aware code.
