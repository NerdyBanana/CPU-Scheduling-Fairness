/**
 * charts.js — Plotly Interactive Performance & Fairness Charts Controller
 * CPU Scheduling Analyzer (Phase 1 Baseline)
 * 
 * Connected to live FastAPI backend (POST /api/simulate) for authentic Python scheduling:
 * - Performance: Waiting Time, Turnaround Time, Response Time, Throughput, CPU Utilization
 * - Fairness: Jain's Fairness Index, Starvation Count, Starvation Threshold, Max Waiting Time, Waiting Time StdDev
 * - Single Source of Truth: phase1_only/schedulers and phase1_only/metrics.py
 * - Zero scheduling or starvation math performed in JavaScript.
 */

(function (window) {
  'use strict';

  // Standard Algorithm Ordering & Palette
  const ALGORITHMS = ['FCFS', 'SJF', 'SRTF', 'RR', 'Priority'];
  const ALGO_LABELS = {
    'FCFS': 'FCFS',
    'SJF': 'SJF',
    'SRTF': 'SRTF',
    'RR': 'Round Robin',
    'Priority': 'Priority'
  };
  const ALGO_COLORS = {
    'FCFS': '#94a3b8',
    'SJF': '#38bdf8',
    'SRTF': '#00f0ff',
    'RR': '#818cf8',
    'Priority': '#f59e0b'
  };

  const PLOTLY_BASE_LAYOUT = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(10, 17, 34, 0.45)',
    font: {
      family: "'Inter', -apple-system, sans-serif",
      color: '#94a3b8',
      size: 11
    },
    margin: { t: 25, r: 20, l: 55, b: 45 },
    xaxis: {
      gridcolor: 'rgba(56, 189, 248, 0.08)',
      zerolinecolor: 'rgba(56, 189, 248, 0.2)',
      tickfont: { color: '#cbd5e1', size: 11 }
    },
    yaxis: {
      gridcolor: 'rgba(56, 189, 248, 0.08)',
      zerolinecolor: 'rgba(56, 189, 248, 0.2)',
      tickfont: { color: '#cbd5e1', size: 11 }
    }
  };

  const PLOTLY_CONFIG = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d']
  };

  window.ChartsController = {
    currentWorkload: 'normal',
    currentSeed: 'mean', // 'mean' or 0-9
    isLive: false,
    currentData: null,
    dataSource: '',

    mount: function () {
      console.log('[ChartsController] Mounting active chart view...');

      // Sync active workload from WorkloadManager if available
      if (window.WorkloadManager) {
        const wmState = window.WorkloadManager.getState();
        if (wmState.workloadType && wmState.workloadType !== 'custom') {
          this.currentWorkload = wmState.workloadType;
        }
      }

      this.bindControls();
      this.renderCurrentView();
    },

    bindControls: function () {
      // Workload selectors on performance or fairness pages
      document.querySelectorAll('.select-chart-workload').forEach(select => {
        select.value = this.currentWorkload;
        select.addEventListener('change', (e) => {
          this.currentWorkload = e.target.value;
          this.renderCurrentView();
        });
      });

      // Seed selectors on performance or fairness pages
      document.querySelectorAll('.select-chart-seed').forEach(select => {
        select.value = this.currentSeed;
        select.addEventListener('change', (e) => {
          this.currentSeed = e.target.value;
          this.renderCurrentView();
        });
      });
    },

    updateStatusBadge: function (status, source) {
      const badges = document.querySelectorAll('.chart-filter-bar .badge');
      badges.forEach(badge => {
        if (status === 'loading') {
          badge.textContent = '⟳ Simulating...';
          badge.className = 'badge badge-primary';
          badge.style.display = 'inline-block';
        } else if (status === 'live') {
          badge.textContent = 'Plotly.js Interactive Graphics';
          badge.className = 'badge badge-cyan';
          badge.style.background = '';
          badge.style.color = '';
          badge.style.opacity = '1';
        } else if (status === 'offline') {
          badge.textContent = '⚠ Backend Offline (Reference Data)';
          badge.className = 'badge badge-danger';
          badge.style.background = '#f43f5e';
          badge.style.color = '#fff';
          badge.style.display = 'inline-block';
        }
      });
    },

    /**
     * Asynchronously requests authentic simulation metrics from Python backend.
     * Fallback to window.BENCHMARK_DATA if backend is offline.
     */
    fetchMetrics: async function (workload, seed) {
      this.updateStatusBadge('loading');

      if (window.SchedulerAPI && typeof window.SchedulerAPI.simulate === 'function') {
        try {
          const res = await window.SchedulerAPI.simulate({
            workload: workload,
            seed: seed,
            algorithms: ALGORITHMS,
            quantum: 2
          });

          if (res && res.status === 'success' && res.results) {
            const liveData = {};
            ALGORITHMS.forEach(algo => {
              if (res.results[algo] && res.results[algo].metrics) {
                const m = res.results[algo].metrics;
                liveData[algo] = {
                  Avg_Waiting_Time: m.Avg_Waiting_Time,
                  Avg_Turnaround_Time: m.Avg_Turnaround_Time,
                  Avg_Response_Time: m.Avg_Response_Time,
                  Throughput: m.Throughput,
                  CPU_Utilization: m.CPU_Utilization <= 1.0 ? m.CPU_Utilization * 100 : m.CPU_Utilization,
                  Jains_Fairness_Index: m.Jains_Fairness_Index,
                  Starvation_Count: m.Starvation_Count,
                  Starvation_Threshold: m.Starvation_Threshold,
                  Max_Waiting_Time: m.Max_Waiting_Time,
                  Waiting_Time_StdDev: m.Waiting_Time_StdDev,
                  // Compatibility aliases
                  avgWait: m.Avg_Waiting_Time,
                  avgTurnaround: m.Avg_Turnaround_Time,
                  avgResponse: m.Avg_Response_Time,
                  throughput: m.Throughput,
                  cpuUtil: m.CPU_Utilization <= 1.0 ? m.CPU_Utilization * 100 : m.CPU_Utilization,
                  jainsFairness: m.Jains_Fairness_Index,
                  starvationCount: m.Starvation_Count,
                  starvationThreshold: m.Starvation_Threshold,
                  maxWait: m.Max_Waiting_Time,
                  waitStdDev: m.Waiting_Time_StdDev
                };
              }
            });

            this.isLive = true;
            this.currentData = liveData;
            this.dataSource = `Authentic Evaluation (${workload}_seed${seed})`;
            this.updateStatusBadge('live', res.source || `${workload}_seed${seed}`);
            console.log(`[ChartsController] Loaded authentic metrics for ${workload} seed ${seed}`);
            return liveData;
          }
        } catch (err) {
          console.warn('[ChartsController] Live backend fetch error, falling back to cache:', err.message);
        }
      }

      // Offline fallback
      this.isLive = false;
      this.updateStatusBadge('offline');
      this.currentData = this.getMetricsData(workload, seed);
      this.dataSource = `Reference Cache (Backend Offline)`;
      return this.currentData;
    },

    renderCurrentView: async function () {
      const activeHash = window.location.hash.replace('#', '').toLowerCase();
      const workload = this.currentWorkload;
      const seed = this.currentSeed;

      const data = await this.fetchMetrics(workload, seed);
      if (activeHash === 'performance') {
        this.renderPerformanceCharts(workload, seed, data);
      } else if (activeHash === 'fairness') {
        this.renderFairnessCharts(workload, seed, data);
      }
    },

    /**
     * Extracts precompiled dataset metrics for offline fallback
     */
    getMetricsData: function (workload = 'normal', seed = 'mean') {
      if (!window.BENCHMARK_DATA) return null;

      const wKey = String(workload).toLowerCase();
      if (seed === 'mean' || seed === 'summary') {
        return (window.BENCHMARK_DATA.summary && window.BENCHMARK_DATA.summary[wKey]) || null;
      } else {
        const sIdx = parseInt(seed, 10);
        return (window.BENCHMARK_DATA.per_run && 
                window.BENCHMARK_DATA.per_run[wKey] && 
                window.BENCHMARK_DATA.per_run[wKey][sIdx]) || null;
      }
    },

    /**
     * Renders Performance Charts:
     * 1. Average Waiting & Turnaround Time
     * 2. Average Response Time
     * (Throughput and CPU Utilization removed per specification)
     */
    renderPerformanceCharts: function (workload = 'normal', seed = 'mean', metricsData = null) {
      const data = metricsData || this.currentData || this.getMetricsData(workload, seed);
      if (!data || typeof Plotly === 'undefined') {
        console.warn('[Charts] Missing data or Plotly library.');
        return;
      }

      const algos = ALGORITHMS.filter(a => data[a]);
      const xLabels = algos.map(a => ALGO_LABELS[a] || a);
      const colors = algos.map(a => ALGO_COLORS[a]);

      // 1. Waiting Time vs Turnaround Time (Grouped Bar Chart)
      const containerWaitTurn = document.getElementById('chart-waiting-turnaround');
      if (containerWaitTurn) {
        const traceWait = {
          x: xLabels,
          y: algos.map(a => data[a].Avg_Waiting_Time !== undefined ? data[a].Avg_Waiting_Time : data[a].avgWait),
          name: 'Avg Waiting Time',
          type: 'bar',
          marker: { color: '#00f0ff' },
          hovertemplate: '<b>%{x}</b><br>Avg Waiting: %{y:.1f} ms<extra></extra>'
        };

        const traceTurn = {
          x: xLabels,
          y: algos.map(a => data[a].Avg_Turnaround_Time !== undefined ? data[a].Avg_Turnaround_Time : data[a].avgTurnaround),
          name: 'Avg Turnaround Time',
          type: 'bar',
          marker: { color: '#38bdf8' },
          hovertemplate: '<b>%{x}</b><br>Avg Turnaround: %{y:.1f} ms<extra></extra>'
        };

        const layout = {
          ...PLOTLY_BASE_LAYOUT,
          barmode: 'group',
          yaxis: { ...PLOTLY_BASE_LAYOUT.yaxis, title: 'Duration (ms)' },
          legend: { orientation: 'h', y: 1.15, x: 0.1, font: { color: '#f8fafc' } }
        };

        Plotly.newPlot(containerWaitTurn, [traceWait, traceTurn], layout, PLOTLY_CONFIG);
      }

      // 2. Average Response Time (Bar Chart)
      const containerResponse = document.getElementById('chart-response-time');
      if (containerResponse) {
        const traceResp = {
          x: xLabels,
          y: algos.map(a => data[a].Avg_Response_Time !== undefined ? data[a].Avg_Response_Time : data[a].avgResponse),
          type: 'bar',
          marker: { color: colors },
          hovertemplate: '<b>%{x}</b><br>Avg Response: %{y:.1f} ms<extra></extra>'
        };

        const layout = {
          ...PLOTLY_BASE_LAYOUT,
          yaxis: { ...PLOTLY_BASE_LAYOUT.yaxis, title: 'Response Latency (ms)' }
        };

        Plotly.newPlot(containerResponse, [traceResp], layout, PLOTLY_CONFIG);
      }

      console.log('[Charts] Rendered performance charts for:', workload, seed);
    },

    /**
     * Renders Fairness Charts:
     * 1. Jain's Fairness Index
     * 2. Starvation Count
     * 3. Maximum Waiting Time
     * 4. Waiting Time Standard Deviation
     */
    renderFairnessCharts: function (workload = 'normal', seed = 'mean', metricsData = null) {
      const data = metricsData || this.currentData || this.getMetricsData(workload, seed);
      if (!data || typeof Plotly === 'undefined') {
        console.warn('[Charts] Missing data or Plotly library.');
        return;
      }

      const algos = ALGORITHMS.filter(a => data[a]);
      const xLabels = algos.map(a => ALGO_LABELS[a] || a);
      const colors = algos.map(a => ALGO_COLORS[a]);

      // 1. Jain's Fairness Index (0.0 to 1.0)
      const containerJains = document.getElementById('chart-jains-fairness');
      if (containerJains) {
        const jainsVals = algos.map(a => data[a].Jains_Fairness_Index !== undefined ? data[a].Jains_Fairness_Index : data[a].jainsFairness);
        const traceJains = {
          x: xLabels,
          y: jainsVals,
          type: 'bar',
          marker: {
            color: jainsVals.map(val => (val >= 0.85 ? '#22c55e' : (val >= 0.6 ? '#38bdf8' : '#f59e0b')))
          },
          hovertemplate: '<b>%{x}</b><br>Jain Index: %{y:.3f}<extra></extra>'
        };

        const layout = {
          ...PLOTLY_BASE_LAYOUT,
          yaxis: { ...PLOTLY_BASE_LAYOUT.yaxis, title: "Jain's Index (0–1)", range: [0, 1.05] }
        };

        Plotly.newPlot(containerJains, [traceJains], layout, PLOTLY_CONFIG);
      }

      // 2. Starvation Count (Wait > 2 * Mean Wait) - Strictly from backend metrics
      const containerStarvation = document.getElementById('chart-starvation-count');
      if (containerStarvation) {
        const starveCounts = algos.map(a => data[a].Starvation_Count !== undefined ? data[a].Starvation_Count : data[a].starvationCount);
        const traceStarve = {
          x: xLabels,
          y: starveCounts,
          type: 'bar',
          marker: {
            color: starveCounts.map(count => (count > 0 ? '#f43f5e' : '#22c55e'))
          },
          hovertemplate: '<b>%{x}</b><br>Starved Tasks: %{y}<extra></extra>'
        };

        const layout = {
          ...PLOTLY_BASE_LAYOUT,
          yaxis: { ...PLOTLY_BASE_LAYOUT.yaxis, title: 'Starved Processes (Count)' }
        };

        Plotly.newPlot(containerStarvation, [traceStarve], layout, PLOTLY_CONFIG);
      }

      // 3. Maximum Waiting Time
      const containerMaxWait = document.getElementById('chart-max-waiting');
      if (containerMaxWait) {
        const traceMax = {
          x: xLabels,
          y: algos.map(a => data[a].Max_Waiting_Time !== undefined ? data[a].Max_Waiting_Time : data[a].maxWait),
          type: 'bar',
          marker: { color: '#f59e0b' },
          hovertemplate: '<b>%{x}</b><br>Max Waiting: %{y} ms<extra></extra>'
        };

        const layout = {
          ...PLOTLY_BASE_LAYOUT,
          yaxis: { ...PLOTLY_BASE_LAYOUT.yaxis, title: 'Max Waiting Time (ms)' }
        };

        Plotly.newPlot(containerMaxWait, [traceMax], layout, PLOTLY_CONFIG);
      }

      // 4. Waiting Time Standard Deviation
      const containerStdDev = document.getElementById('chart-wait-stddev');
      if (containerStdDev) {
        const traceStd = {
          x: xLabels,
          y: algos.map(a => data[a].Waiting_Time_StdDev !== undefined ? data[a].Waiting_Time_StdDev : data[a].waitStdDev),
          type: 'bar',
          marker: { color: '#c084fc' },
          hovertemplate: '<b>%{x}</b><br>Waiting StdDev: %{y} ms<extra></extra>'
        };

        const layout = {
          ...PLOTLY_BASE_LAYOUT,
          yaxis: { ...PLOTLY_BASE_LAYOUT.yaxis, title: 'StdDev (ms)' }
        };

        Plotly.newPlot(containerStdDev, [traceStd], layout, PLOTLY_CONFIG);
      }

      console.log('[Charts] Rendered fairness charts for:', workload, seed);
    }
  };

})(window);
