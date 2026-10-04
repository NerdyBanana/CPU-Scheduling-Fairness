# Phase 1 CPU Scheduling Simulator --- New UI & Architecture Specification

## 1. Project Context

This project implements **Problem Statement 18: Fairness-Aware CPU
Scheduling using FCFS, SJF/SRTF, Round Robin, and Priority Scheduling**.

Phase 1 is the **baseline implementation**. It must implement and
compare:

-   FCFS
-   SJF
-   SRTF
-   Round Robin
-   Priority Scheduling

The project uses common process datasets containing:

-   PID
-   Arrival Time
-   Burst Time
-   Priority

The current implementation already has the scheduling algorithms,
metrics, dataset generation, experiment runner, CSV result generation,
and Gantt-chart generation.

### Important

**Do not rewrite the scheduling algorithms unnecessarily.**

The main goal of this change is to add a professional UI and
visualization layer on top of the existing Phase 1 engine while keeping
the core scheduling logic modular and testable.

------------------------------------------------------------------------

# 2. Current Architecture

The current project is structured approximately as follows:

``` text
phase1_only/
│
├── dataset_gen.py
│
├── metrics.py
│
├── schedulers/
│   ├── fcfs.py
│   ├── sjf_srtf.py
│   ├── round_robin.py
│   └── priority.py
│
├── main_phase1.py
├── plot_gantt_example.py
│
├── data/
│   └── generated workload CSV files
│
└── results/
    ├── phase1_per_run.csv
    ├── phase1_summary.csv
    ├── phase1_summary.png
    └── phase1_gantt_example.png
```

The existing implementation already:

1.  Generates normal, skewed, and bursty workloads.
2.  Runs the scheduling algorithms.
3.  Calculates performance metrics.
4.  Saves per-run results.
5.  Produces summary results.
6.  Produces a Gantt chart.

The current output is primarily terminal/CSV based.

------------------------------------------------------------------------

# 3. New Architecture

The new system should follow a **layered architecture**.

``` text
                         CPU SCHEDULING ANALYZER
                                  │
                 ┌────────────────┴────────────────┐
                 │                                 │
             UI LAYER                         CORE ENGINE
                 │                                 │
             app.py                     ┌─────────┼─────────┐
                 │                       │         │         │
          ┌──────┼──────┐              Dataset  Scheduler  Metrics
          │      │      │                │         │         │
        Tables Charts Gantt              │    ┌────┼────┐    │
          │      │      │                │    │    │    │    │
          └──────┼──────┘               CSV  FCFS  SJF  SRTF  RR  Priority
                 │                       │         │         │
                 └─────────────── Results/CSV ─────┘
```

## Principle

The UI should **consume the existing scheduling engine**.

The UI should not contain duplicate implementations of FCFS, SJF, SRTF,
RR, or Priority.

This gives us:

-   cleaner code
-   easier debugging
-   easier testing
-   easier Phase 2 integration
-   separation between computation and presentation

------------------------------------------------------------------------

# 4. Recommended Technology

Use **Streamlit** for the UI.

The application should be launched with:

``` bash
streamlit run app.py
```

The browser becomes the front end of the CPU scheduling simulator.

The project should remain Python-based.

------------------------------------------------------------------------

# 5. Proposed Final Folder Structure

Use the following structure:

``` text
phase1_only/
│
├── app.py                         # Main Streamlit UI
│
├── dataset_gen.py                 # Workload generation
├── metrics.py                     # Metric calculations
├── main_phase1.py                 # Batch experiment runner
├── plot_gantt_example.py          # Existing Gantt utility
│
├── schedulers/
│   ├── __init__.py
│   ├── fcfs.py
│   ├── sjf_srtf.py
│   ├── round_robin.py
│   └── priority.py
│
├── data/
│   ├── workload_normal.csv
│   ├── workload_skewed.csv
│   └── workload_bursty.csv
│
├── results/
│   ├── phase1_per_run.csv
│   ├── phase1_summary.csv
│   └── gantt/
│
├── graphs/
│
├── requirements.txt
├── README.md
└── PHASE1_UI_ARCHITECTURE.md
```

If the existing filenames differ, preserve the existing working files
and adapt the UI to them rather than breaking the current
implementation.

------------------------------------------------------------------------

# 6. UI Design

The UI should look like a **CPU Scheduling Analysis Dashboard**, not a
simple form.

## Main page

Suggested title:

``` text
CPU Scheduling Analyzer
Phase 1 — Baseline Fairness & Performance Analysis
```

Add a short description:

``` text
Compare classical CPU scheduling algorithms under different workloads
and analyze performance, CPU allocation fairness, and starvation.
```

------------------------------------------------------------------------

# 7. Sidebar Controls

The sidebar should contain the experiment controls.

## Workload

Provide:

``` text
Workload
[ Normal ▼ ]
```

Options:

-   Normal
-   Skewed
-   Bursty

These correspond to the existing workload types.

### Normal

Balanced arrivals and burst times.

### Skewed

Mostly short jobs with a few very long jobs.

This workload is useful for exposing fairness problems in algorithms
that favour short jobs.

### Bursty

Processes arrive in clusters, stressing queue congestion.

------------------------------------------------------------------------

## Round Robin Quantum

Provide:

``` text
Round Robin Time Quantum
[ 4 ]
```

Allow the value to be changed.

Default:

``` text
4
```

The value should be passed to the existing Round Robin implementation
rather than reimplementing RR inside the UI.

------------------------------------------------------------------------

## Algorithm selection

Provide either:

``` text
Algorithms
☑ FCFS
☑ SJF
☑ SRTF
☑ Round Robin
☑ Priority
```

or a "Run All Algorithms" option.

For the main comparison dashboard, **Run All Algorithms** should be the
default.

------------------------------------------------------------------------

## Buttons

Provide:

``` text
[ Run Simulation ]
[ Run Full Experiment ]
```

### Run Simulation

Runs the currently selected workload and algorithms.

### Run Full Experiment

Runs the experiment across the configured workload types/seeds and
updates the result files.

------------------------------------------------------------------------

# 8. Dashboard Layout

The main dashboard should have these sections.

``` text
┌──────────────────────────────────────────────────────────────┐
│ CPU SCHEDULING ANALYZER                                      │
│ Phase 1 — Baseline Fairness & Performance Analysis           │
├──────────────────────────────────────────────────────────────┤
│ Workload: Normal        RR Quantum: 4                        │
│ [ Run Simulation ]                                            │
├──────────────────────────────────────────────────────────────┤
│ KPI CARDS                                                     │
│ Best Waiting | Best Fairness | Lowest Starvation | Processes │
├──────────────────────────────────────────────────────────────┤
│ Process Dataset                                               │
├──────────────────────────────────────────────────────────────┤
│ Performance Comparison                                       │
├──────────────────────────────────────────────────────────────┤
│ Fairness Comparison                                           │
├──────────────────────────────────────────────────────────────┤
│ Starvation Comparison                                         │
├──────────────────────────────────────────────────────────────┤
│ Gantt Chart                                                   │
├──────────────────────────────────────────────────────────────┤
│ Detailed Process Results                                     │
├──────────────────────────────────────────────────────────────┤
│ Fairness Analysis                                             │
└──────────────────────────────────────────────────────────────┘
```

------------------------------------------------------------------------

# 9. KPI Cards

Show a small summary at the top.

Recommended cards:

### Best Average Waiting Time

Display:

``` text
SRTF
100.13 ms
```

The actual value must come from the current simulation.

### Best Fairness

Display the algorithm with the highest Jain's Fairness Index.

Example:

``` text
RR
0.91
```

### Lowest Starvation

Display the algorithm with the lowest starvation count.

Example:

``` text
RR
0
```

### Number of Processes

Display:

``` text
8
```

These values must be dynamically calculated. Do not hard-code them.

------------------------------------------------------------------------

# 10. Process Dataset Table

Display the currently selected workload.

Columns:

``` text
PID
Arrival Time
Burst Time
Priority
```

Example:

  PID     Arrival   Burst   Priority
  ----- --------- ------- ----------
  P1            0       5          3
  P2            1       3          1
  P3            2       8          4

This allows the user to understand what the scheduler is processing.

------------------------------------------------------------------------

# 11. Performance Charts

The dashboard should contain separate charts rather than one overloaded
chart.

## Chart 1 --- Average Waiting Time

Bar chart.

X-axis:

``` text
Algorithm
```

Y-axis:

``` text
Average Waiting Time
```

Compare:

-   FCFS
-   SJF
-   SRTF
-   RR
-   Priority

Lower is better.

------------------------------------------------------------------------

## Chart 2 --- Average Turnaround Time

Bar chart.

Lower is better.

------------------------------------------------------------------------

## Chart 3 --- Average Response Time

Bar chart.

Lower is generally better, especially for interactive workloads.

------------------------------------------------------------------------

## Chart 4 --- Jain's Fairness Index

Bar chart.

Y-axis:

``` text
0 to 1
```

Higher is better.

Example interpretation:

``` text
1.00 = very even CPU allocation
0.90 = highly fair
0.70 = moderate fairness
0.50 = relatively uneven
```

Do not treat these example labels as formal universal thresholds. The
actual project should compare algorithms relative to each other.

------------------------------------------------------------------------

## Chart 5 --- Starvation Count

Bar chart.

Lower is better.

This chart should show the number of processes classified as starved by
the project's starvation rule.

------------------------------------------------------------------------

# 12. Fairness System for Phase 1

Phase 1 should use two primary fairness-related measures.

## 12.1 Jain's Fairness Index

Jain's Fairness Index provides a single fairness score.

Formula:

``` text
J = (sum(x))² / (n × sum(x²))
```

where:

-   `x` represents the chosen CPU-allocation measure for each process.
-   `n` is the number of processes.

The result is between 0 and 1.

``` text
0 ----------------------------- 1
unfair                         fair
```

### Important implementation requirement

Before changing the current implementation, **inspect how the existing
`metrics.py` calculates Jain's index**.

Do not blindly replace it.

The metric must measure the intended fairness concept rather than simply
reflecting differences in process burst lengths.

The implementation should document exactly what `x_i` represents.

------------------------------------------------------------------------

# 13. Starvation System for Phase 1

Starvation means that a process waits for an excessively long time
because other processes continue receiving CPU service.

Phase 1 should report:

``` text
Starvation Count
```

This means:

> Number of processes that satisfy the project's starvation condition.

The starvation condition must be explicitly defined in the code and
documentation.

Do not label every process with a high waiting time as automatically
starved.

A process should be considered starved only when it crosses the defined
starvation criterion.

------------------------------------------------------------------------

# 14. Supporting Fairness Metrics

In addition to Jain's index and starvation count, show:

-   Average waiting time
-   Maximum waiting time
-   Per-process waiting time
-   Per-process response time

This helps distinguish:

``` text
Overall fairness
        vs
Individual bad cases
```

For example, an algorithm may have a reasonable average waiting time but
still leave one process waiting much longer than the others.

------------------------------------------------------------------------

# 15. Fairness Analysis Section

Add a dedicated section:

``` text
Fairness Analysis
```

It should explain the current results in simple language.

Example:

``` text
Round Robin has the highest Jain's Fairness Index for this workload,
indicating the most even CPU allocation among the tested algorithms.

SJF/SRTF provide lower waiting times for this workload, but some
longer processes experience greater waiting/starvation risk.
```

This text must be generated from the actual results where practical.

Do not hard-code claims such as "RR is always the fairest" because the
result depends on the workload and fairness definition.

------------------------------------------------------------------------

# 16. Gantt Chart

The existing Gantt-chart functionality should be integrated into the UI.

The user should be able to select:

``` text
Algorithm
[ SRTF ▼ ]
```

and see the corresponding Gantt chart.

The chart should show:

-   Process ID
-   Start time
-   End time
-   CPU execution order
-   Idle periods if applicable

Example:

``` text
0       4       7       12      16

|  P1   |  P2   |   P3   | P1  |
```

The Gantt chart should be generated from actual scheduler output.

Do not create fake/static Gantt data for presentation.

------------------------------------------------------------------------

# 17. Detailed Results Table

Add a table for individual process metrics.

Recommended columns:

``` text
PID
Arrival Time
Burst Time
Priority
First Start
Completion
Waiting Time
Turnaround Time
Response Time
Starvation
```

This table is important because the project is concerned with fairness
at the process level, not only averages.

Allow the table to be filtered by algorithm if practical.

------------------------------------------------------------------------

# 18. Workload Comparison

Add a section that compares:

``` text
Normal
Skewed
Bursty
```

This is important for the research experiment.

Possible charts:

### Fairness by workload

``` text
Workload → Algorithm → Jain Fairness
```

### Waiting time by workload

``` text
Workload → Algorithm → Average Waiting Time
```

### Starvation by workload

``` text
Workload → Algorithm → Starvation Count
```

This lets the user demonstrate that algorithm performance changes
depending on workload characteristics.

------------------------------------------------------------------------

# 19. Results Data Flow

The UI should follow this data flow:

``` text
User selects workload
        ↓
Load CSV
        ↓
Display process dataset
        ↓
Run selected scheduler(s)
        ↓
Scheduler returns execution timeline/results
        ↓
metrics.py calculates metrics
        ↓
UI receives structured results
        ↓
Display:
    ├── KPI cards
    ├── tables
    ├── performance charts
    ├── fairness chart
    ├── starvation chart
    └── Gantt chart
```

------------------------------------------------------------------------

# 20. Important Separation of Responsibilities

## dataset_gen.py

Responsible for:

-   Generating workloads
-   Saving workload CSV files

It should not contain UI code.

------------------------------------------------------------------------

## schedulers/

Responsible for:

-   FCFS
-   SJF
-   SRTF
-   Round Robin
-   Priority

These files should remain independent of Streamlit.

They should return structured scheduling results.

------------------------------------------------------------------------

## metrics.py

Responsible for:

-   Waiting time
-   Turnaround time
-   Response time
-   Throughput
-   CPU utilization
-   Jain's Fairness Index
-   Starvation count

The UI should call these functions rather than duplicate the formulas.

------------------------------------------------------------------------

## main_phase1.py

Responsible for:

-   Running batch experiments
-   Running multiple seeds
-   Producing per-run results
-   Producing summary results

Keep this useful for command-line experiments.

------------------------------------------------------------------------

## app.py

Responsible for:

-   User interface
-   Controls
-   Loading data
-   Calling the scheduler
-   Calling metrics
-   Tables
-   Charts
-   Gantt visualization
-   Result interpretation

It should **not** implement scheduling algorithms itself.

------------------------------------------------------------------------

# 21. Preserve Terminal Mode

Do not remove the existing terminal workflow.

Keep:

``` bash
python3 dataset_gen.py
python3 main_phase1.py
python3 plot_gantt_example.py
```

The project should support both:

``` text
Command Line
     +
Web Dashboard
```

This is useful for debugging, reproducibility, and research experiments.

------------------------------------------------------------------------

# 22. Current Result Files

Continue using:

``` text
results/phase1_per_run.csv
results/phase1_summary.csv
```

The UI can read these files for experiment-level analysis.

Do not create multiple competing result formats unless necessary.

------------------------------------------------------------------------

# 23. Example Dashboard Interpretation

Suppose the current simulation gives:

``` text
Algorithm    Avg WT    Avg TAT    Fairness    Starvation
FCFS         131.45    143.84       0.74         0.4
Priority     130.71    143.10       0.69         1.8
RR           201.66    214.04       0.91         0.0
SJF          100.28    112.66       0.57         4.3
SRTF         100.13    112.52       0.57         4.3
```

The UI should make the trade-off visible:

``` text
Lowest waiting time:
SRTF

Highest fairness:
RR

Lowest starvation:
RR
```

The dashboard should not simply declare one algorithm "best".

Instead, it should communicate:

> Different algorithms optimize different goals. SJF/SRTF may provide
> lower waiting time for some workloads, while Round Robin may provide
> more even CPU access and lower starvation. The purpose of Phase 1 is
> to measure these trade-offs.

------------------------------------------------------------------------

# 24. UI Design Principles

Keep the UI:

-   Clean
-   Academic
-   Professional
-   Easy to understand
-   Not overly flashy
-   Focused on data

Avoid:

-   Excessive animations
-   Unnecessary gradients
-   Decorative elements that do not communicate information
-   Fake AI features
-   Hard-coded results
-   Duplicate scheduling logic

Use clear terminology:

``` text
Waiting Time
Turnaround Time
Response Time
CPU Utilization
Throughput
Fairness
Starvation
```

------------------------------------------------------------------------

# 25. Phase 1 Must NOT Include

Do not add the Phase 2 AI system yet.

Do not include:

-   Machine learning prediction
-   Starvation-risk classifier
-   Adaptive scheduling
-   Dynamic priority modification
-   AI-based scheduler selection

Those belong to Phase 2.

The Phase 1 UI may mention that these are future improvements, but it
must not pretend they are implemented.

------------------------------------------------------------------------

# 26. Future Phase 2 Compatibility

The architecture should make Phase 2 easy to add later.

Future structure:

``` text
Phase 1
Classical Scheduler
       ↓
Metrics
       ↓
Fairness / Starvation Analysis
       ↓
Phase 2
Risk Prediction
       ↓
Fairness-Aware Adjustment
       ↓
Improved Scheduler
       ↓
Same Metrics
       ↓
Phase 1 vs Phase 2 comparison
```

The same UI can later receive a new section:

``` text
Baseline vs Fairness-Aware Scheduler
```

without replacing the Phase 1 dashboard.

------------------------------------------------------------------------

# 27. Testing Requirements

Before considering the UI complete:

### Test 1

Run normal workload.

Verify all algorithms execute.

### Test 2

Run skewed workload.

Verify all algorithms execute.

### Test 3

Run bursty workload.

Verify all algorithms execute.

### Test 4

Change Round Robin quantum.

Verify RR results change accordingly.

### Test 5

Check Gantt chart.

Verify execution order matches scheduler output.

### Test 6

Check metrics.

Verify UI values match `phase1_summary.csv` / scheduler calculations.

### Test 7

Check fairness.

Verify Jain's index displayed by the UI is the same value produced by
the metrics layer.

### Test 8

Check starvation.

Verify starvation count matches the defined starvation rule.

------------------------------------------------------------------------

# 28. What Antigravity Should Do First

Do the implementation in this order.

## Step 1 --- Inspect

Inspect the existing:

``` text
metrics.py
dataset_gen.py
main_phase1.py
schedulers/*.py
plot_gantt_example.py
```

Do not rewrite them immediately.

Understand their function signatures and output formats.

------------------------------------------------------------------------

## Step 2 --- Verify Metrics

Verify:

-   waiting time
-   turnaround time
-   response time
-   throughput
-   CPU utilization
-   Jain's fairness index
-   starvation count

Document the exact definitions.

Especially verify the Jain's Fairness Index input values and starvation
threshold.

------------------------------------------------------------------------

## Step 3 --- Refactor Only If Necessary

If the existing schedulers return results in incompatible formats,
create a small common result adapter/helper.

Do not rewrite working algorithms simply for style.

------------------------------------------------------------------------

## Step 4 --- Build app.py

Create the Streamlit dashboard.

Connect it to the existing scheduler and metrics code.

------------------------------------------------------------------------

## Step 5 --- Add Tables

Implement:

-   workload table
-   summary results table
-   per-process results table

------------------------------------------------------------------------

## Step 6 --- Add Charts

Implement:

1.  Average waiting time
2.  Average turnaround time
3.  Average response time
4.  Jain fairness
5.  Starvation count
6.  Workload comparison

------------------------------------------------------------------------

## Step 7 --- Add Gantt Chart

Integrate the existing Gantt functionality.

------------------------------------------------------------------------

## Step 8 --- Test

Compare UI results against terminal/CSV results.

The UI must not produce different results from the existing Phase 1
engine.

------------------------------------------------------------------------

# 29. Definition of Done

Phase 1 UI is complete when:

-   [ ] Existing algorithms still work.
-   [ ] FCFS works.
-   [ ] SJF works.
-   [ ] SRTF works.
-   [ ] Round Robin works.
-   [ ] Priority works.
-   [ ] Normal workload works.
-   [ ] Skewed workload works.
-   [ ] Bursty workload works.
-   [ ] RR quantum can be configured.
-   [ ] Waiting time is displayed.
-   [ ] Turnaround time is displayed.
-   [ ] Response time is displayed.
-   [ ] Throughput is displayed.
-   [ ] CPU utilization is displayed.
-   [ ] Jain's Fairness Index is displayed.
-   [ ] Starvation count is displayed.
-   [ ] Per-process results are displayed.
-   [ ] Gantt chart is displayed.
-   [ ] Performance graphs are displayed.
-   [ ] Fairness graph is displayed.
-   [ ] Starvation graph is displayed.
-   [ ] Results are based on real simulation output.
-   [ ] No Phase 2 AI functionality is falsely presented.
-   [ ] Terminal mode still works.
-   [ ] UI results match the underlying engine.

------------------------------------------------------------------------

# 30. Short Project Explanation

Use this explanation when describing the new architecture:

> "The project uses a layered architecture. The existing Phase 1
> scheduling engine remains responsible for workload generation,
> scheduling algorithms, and metric calculation. A new Streamlit
> presentation layer provides an interactive dashboard over this engine.
> Users can select workloads and Round Robin parameters, run the
> classical scheduling algorithms, and visualize waiting time,
> turnaround time, response time, CPU utilization, throughput, Jain's
> Fairness Index, starvation count, and Gantt charts. This keeps the
> scheduling logic independent from the UI and provides a clean
> foundation for adding the fairness-aware prediction component in Phase
> 2."

------------------------------------------------------------------------

# 31. Important Instruction to Antigravity

**Do not treat this document as permission to rewrite the whole
project.**

First inspect the current code.

Preserve existing working functionality.

Make the smallest architectural changes necessary to expose scheduler
results cleanly to the UI.

The primary goal is:

``` text
Existing Phase 1 Engine
        +
Professional Interactive UI
        +
Clear Graphs
        +
Fairness & Starvation Analysis
```

not:

``` text
Rewrite everything from scratch.
```
