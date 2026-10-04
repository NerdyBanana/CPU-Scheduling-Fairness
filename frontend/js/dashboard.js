/**
 * dashboard.js — Executive Dashboard Controller & Live KPI Aggregator
 * CPU Scheduling Analyzer (Phase 1 Baseline)
 * 
 * Connected to live FastAPI backend (POST /api/simulate):
 * - Live KPI Cards: Best Avg Waiting Time, Highest Fairness, Lowest Starvation, Total Processes
 * - Algorithm Comparison Matrix: FCFS, SJF, SRTF, Round Robin, Priority
 * - Environment Panel: Active Workload, Seed, Process count, RR quantum, Backend status, Data source
 * - Single Source of Truth: Python schedulers & phase1_only/metrics.py
 * - Zero scheduling or starvation math performed in JavaScript.
 * - Labeled reference fallback if backend is offline.
 */

(function (window) {
  'use strict';

  const ALGORITHM_CONFIGS = [
    { key: 'FCFS', label: 'FCFS', tag: 'Baseline', badge: 'badge-neutral' },
    { key: 'SJF', label: 'SJF (Non-preemptive)', tag: 'Shortest Job', badge: 'badge-cyan' },
    { key: 'SRTF', label: 'SRTF (Preemptive)', tag: 'Optimal Waiting', badge: 'badge-success', highlight: true },
    { key: 'RR', label: 'Round Robin (q=2)', tag: 'Most Fair', badge: 'badge-primary', highlight: true },
    { key: 'Priority', label: 'Priority (Non-preemptive)', tag: 'Priority-Bound', badge: 'badge-warning' }
  ];

  window.DashboardController = {
    activeWorkload: 'normal',
    activeSeed: 'mean', // 'mean' or 0-9
    activeQuantum: 2,
    activeProcessCount: 25,
    isLive: false,
    currentResults: null,

    mount: function () {
      console.log('[DashboardController] Mounting Executive Dashboard...');

      // Sync active workload from WorkloadManager if available
      if (window.WorkloadManager) {
        const wm = window.WorkloadManager.getState();
        if (wm.workloadType && wm.workloadType !== 'custom') {
          this.activeWorkload = wm.workloadType;
        }
      }

      this.bindActions();
      this.updateDashboardKPIs(this.activeWorkload, this.activeSeed);
    },

    bindActions: function () {
      // Workload Selector
      const selectWorkload = document.getElementById('select-dashboard-workload');
      if (selectWorkload) {
        selectWorkload.value = this.activeWorkload;
        selectWorkload.addEventListener('change', (e) => {
          this.activeWorkload = e.target.value;
          this.updateDashboardKPIs(this.activeWorkload, this.activeSeed);
        });
      }

      // Seed Selector
      const selectSeed = document.getElementById('select-dashboard-seed');
      if (selectSeed) {
        selectSeed.value = this.activeSeed;
        selectSeed.addEventListener('change', (e) => {
          this.activeSeed = e.target.value;
          this.updateDashboardKPIs(this.activeWorkload, this.activeSeed);
        });
      }
    },

    /**
     * Updates status badges across the Dashboard view
     */
    updateStatusBadge: function (status, sourceText) {
      const badge = document.getElementById('dashboard-status-badge');
      if (badge) {
        if (status === 'loading') {
          badge.textContent = '⟳ Evaluating...';
          badge.className = 'badge badge-primary';
          badge.style.display = 'inline-block';
        } else if (status === 'live') {
          badge.textContent = '150 Scenarios Evaluated';
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
      }

      // Environment Card Badge & Values
      const envBadge = document.getElementById('dashboard-env-badge');
      const envStatus = document.getElementById('env-status-val');
      const envSource = document.getElementById('env-source-val');

      if (status === 'live') {
        if (envBadge) {
          envBadge.textContent = 'Active';
          envBadge.className = 'badge badge-primary';
          envBadge.style.background = '';
          envBadge.style.color = '';
        }
        if (envStatus) {
          envStatus.textContent = 'Operational';
          envStatus.style.color = 'var(--accent-cyan)';
        }
        if (envSource) {
          envSource.textContent = sourceText || 'FastAPI REST API';
        }
      } else if (status === 'offline') {
        if (envBadge) {
          envBadge.textContent = '⚠ Reference Data';
          envBadge.className = 'badge';
          envBadge.style.background = '#f43f5e';
          envBadge.style.color = '#fff';
        }
        if (envStatus) {
          envStatus.textContent = 'Reference Data / Backend Offline';
          envStatus.style.color = '#fb7185';
        }
        if (envSource) {
          envSource.textContent = 'Local Cached Reference';
        }
      }
    },

    /**
     * Updates Environment Context list values
     */
    updateEnvironmentPanel: function (workload, seed, procCount, quantum) {
      const elWorkload = document.getElementById('env-workload-val');
      const elSeed = document.getElementById('env-seed-val');
      const elProcs = document.getElementById('env-procs-val');
      const elQuantum = document.getElementById('env-quantum-val');

      const wLabels = {
        'normal': 'Gaussian (Normal)',
        'skewed': 'Bimodal (Skewed)',
        'bursty': 'Clustered (Bursty)'
      };

      if (elWorkload) elWorkload.textContent = wLabels[workload] || (workload.toUpperCase());
      if (elSeed) elSeed.textContent = (seed === 'mean' || seed === 'summary') ? 'Aggregate Mean (Seeds 0–9)' : `Seed ${seed}`;
      if (elProcs) elProcs.textContent = `${procCount} Tasks`;
      if (elQuantum) elQuantum.textContent = `${quantum} ms`;
    },

    /**
     * Fetches live simulation metrics across all 5 algorithms and updates Dashboard
     */
    updateDashboardKPIs: async function (workload = 'normal', seed = 'mean') {
      const wKey = String(workload).toLowerCase();
      const sVal = seed;
      this.updateStatusBadge('loading');

      // 1. Attempt Live Simulation Call to FastAPI Backend
      if (window.SchedulerAPI && typeof window.SchedulerAPI.simulate === 'function') {
        try {
          const res = await window.SchedulerAPI.simulate({
            workload: wKey,
            seed: sVal,
            algorithms: ['FCFS', 'SJF', 'SRTF', 'RR', 'Priority'],
            quantum: this.activeQuantum
          });

          if (res && res.status === 'success' && res.results) {
            this.isLive = true;
            this.currentResults = res.results;
            this.activeProcessCount = res.process_count || 25;

            this.renderLiveDashboard(wKey, sVal, res.results, res.source);
            this.updateStatusBadge('live', res.source);
            this.updateEnvironmentPanel(wKey, sVal, this.activeProcessCount, this.activeQuantum);
            console.log(`[DashboardController] Rendered live dashboard for ${wKey} seed ${sVal}`);
            return;
          }
        } catch (err) {
          console.warn('[DashboardController] Live backend fetch error, falling back to cache:', err.message);
        }
      }

      // 2. Offline Fallback to Precompiled window.BENCHMARK_DATA
      this.isLive = false;
      this.renderOfflineDashboard(wKey, sVal);
      this.updateStatusBadge('offline');
      this.updateEnvironmentPanel(wKey, sVal, 25, this.activeQuantum);
    },

    /**
     * Renders Live KPIs and Comparison Table from FastAPI simulation response
     */
    renderLiveDashboard: function (workload, seed, results, source) {
      const algos = ['FCFS', 'SJF', 'SRTF', 'RR', 'Priority'];
      const validAlgos = algos.filter(a => results[a] && results[a].metrics);

      if (validAlgos.length === 0) return;

      // 1. Best Avg Waiting Time (minimum across 5 algorithms)
      let bestWait = Infinity;
      let bestWaitAlgo = 'SRTF';
      validAlgos.forEach(a => {
        const wait = results[a].metrics.Avg_Waiting_Time;
        if (wait < bestWait) {
          bestWait = wait;
          bestWaitAlgo = (a === 'RR') ? 'Round Robin' : a;
        }
      });

      // 2. Highest Jain's Fairness Index (maximum across 5 algorithms)
      let bestFairness = -Infinity;
      let bestFairnessAlgo = 'RR';
      validAlgos.forEach(a => {
        const jain = results[a].metrics.Jains_Fairness_Index;
        if (jain > bestFairness) {
          bestFairness = jain;
          bestFairnessAlgo = (a === 'RR') ? 'Round Robin (q=2)' : a;
        }
      });

      // 3. Lowest Starvation Count (minimum across 5 algorithms)
      let minStarve = Infinity;
      validAlgos.forEach(a => {
        const starve = results[a].metrics.Starvation_Count;
        if (starve < minStarve) {
          minStarve = starve;
        }
      });

      // 4. Total Processes
      const procCount = this.activeProcessCount;

      // Update KPI DOM Cards
      const elWaitVal = document.getElementById('kpi-best-wait-val');
      const elWaitSub = document.getElementById('kpi-best-wait-sub');
      if (elWaitVal) elWaitVal.innerHTML = `${bestWait.toFixed(1)} <span style="font-size:15px; color:var(--text-secondary)">ms</span>`;
      if (elWaitSub) elWaitSub.innerHTML = `<span class="kpi-highlight">${bestWaitAlgo}</span> achieves lowest latency (${workload})`;

      const elFairVal = document.getElementById('kpi-highest-fair-val');
      const elFairSub = document.getElementById('kpi-highest-fair-sub');
      if (elFairVal) elFairVal.textContent = bestFairness.toFixed(3);
      if (elFairSub) elFairSub.innerHTML = `<span class="kpi-highlight">${bestFairnessAlgo}</span> Jain's Index (${workload})`;

      const elStarveVal = document.getElementById('kpi-lowest-starve-val');
      const elStarveSub = document.getElementById('kpi-lowest-starve-sub');
      if (elStarveVal) elStarveVal.innerHTML = `${minStarve} <span style="font-size:15px; color:var(--text-secondary)">processes</span>`;
      if (elStarveSub) elStarveSub.textContent = `Threshold: 2 × Mean Waiting Time`;

      const elProcVal = document.getElementById('kpi-total-procs-val');
      const elProcSub = document.getElementById('kpi-total-procs-sub');
      if (elProcVal) elProcVal.innerHTML = `${procCount} <span style="font-size:15px; color:var(--text-secondary)">tasks</span>`;
      if (elProcSub) elProcSub.textContent = `Active Workload: ${workload.toUpperCase()} (${seed === 'mean' ? 'Aggregate' : 'Seed ' + seed})`;

      // Update Comparison Table Rows
      const tableBody = document.getElementById('dashboard-comparison-table-body');
      if (tableBody) {
        tableBody.innerHTML = ALGORITHM_CONFIGS.map(cfg => {
          const res = results[cfg.key];
          const m = res ? res.metrics : {
            Avg_Waiting_Time: 0, Avg_Turnaround_Time: 0, Avg_Response_Time: 0,
            Jains_Fairness_Index: 0, Starvation_Count: 0
          };
          const bg = cfg.highlight ? 'style="background: rgba(0, 240, 255, 0.04);"' : '';

          return `
            <tr ${bg}>
              <td><strong>${cfg.label}</strong></td>
              <td>${m.Avg_Waiting_Time.toFixed(1)}</td>
              <td>${m.Avg_Turnaround_Time.toFixed(1)}</td>
              <td>${m.Avg_Response_Time.toFixed(1)}</td>
              <td>${m.Jains_Fairness_Index.toFixed(3)}</td>
              <td>${m.Starvation_Count}</td>
              <td><span class="badge ${cfg.badge}">${cfg.tag}</span></td>
            </tr>
          `;
        }).join('');
      }
    },

    /**
     * Offline Fallback renderer using window.BENCHMARK_DATA
     */
    renderOfflineDashboard: function (workload, seed) {
      if (!window.BENCHMARK_DATA || !window.BENCHMARK_DATA.summary) {
        console.warn('[Dashboard] BENCHMARK_DATA unavailable for offline fallback.');
        return;
      }

      const summary = window.BENCHMARK_DATA.summary[workload] || window.BENCHMARK_DATA.summary['normal'];
      if (!summary) return;

      const algos = ['FCFS', 'SJF', 'SRTF', 'RR', 'Priority'];

      let bestWait = Infinity;
      let bestWaitAlgo = 'SRTF';
      algos.forEach(a => {
        if (summary[a] && summary[a].avgWait < bestWait) {
          bestWait = summary[a].avgWait;
          bestWaitAlgo = (a === 'RR') ? 'Round Robin' : a;
        }
      });

      let bestFairness = -Infinity;
      let bestFairnessAlgo = 'RR';
      algos.forEach(a => {
        if (summary[a] && summary[a].jainsFairness > bestFairness) {
          bestFairness = summary[a].jainsFairness;
          bestFairnessAlgo = (a === 'RR') ? 'Round Robin (q=2)' : a;
        }
      });

      let minStarve = Infinity;
      algos.forEach(a => {
        if (summary[a] && summary[a].starvationCount < minStarve) {
          minStarve = summary[a].starvationCount;
        }
      });

      const elWaitVal = document.getElementById('kpi-best-wait-val');
      const elWaitSub = document.getElementById('kpi-best-wait-sub');
      if (elWaitVal) elWaitVal.innerHTML = `${bestWait.toFixed(1)} <span style="font-size:15px; color:var(--text-secondary)">ms</span>`;
      if (elWaitSub) elWaitSub.innerHTML = `<span class="kpi-highlight">${bestWaitAlgo}</span> lowest latency [Reference]`;

      const elFairVal = document.getElementById('kpi-highest-fair-val');
      const elFairSub = document.getElementById('kpi-highest-fair-sub');
      if (elFairVal) elFairVal.textContent = bestFairness.toFixed(3);
      if (elFairSub) elFairSub.innerHTML = `<span class="kpi-highlight">${bestFairnessAlgo}</span> Jain's [Reference]`;

      const elStarveVal = document.getElementById('kpi-lowest-starve-val');
      const elStarveSub = document.getElementById('kpi-lowest-starve-sub');
      if (elStarveVal) elStarveVal.innerHTML = `${minStarve.toFixed(0)} <span style="font-size:15px; color:var(--text-secondary)">processes</span>`;
      if (elStarveSub) elStarveSub.textContent = `Threshold: 2 × Mean Waiting Time [Reference]`;

      const elProcVal = document.getElementById('kpi-total-procs-val');
      const elProcSub = document.getElementById('kpi-total-procs-sub');
      if (elProcVal) elProcVal.innerHTML = `25 <span style="font-size:15px; color:var(--text-secondary)">tasks</span>`;
      if (elProcSub) elProcSub.textContent = `Reference: ${workload.toUpperCase()} (Backend Offline)`;

      const tableBody = document.getElementById('dashboard-comparison-table-body');
      if (tableBody) {
        tableBody.innerHTML = ALGORITHM_CONFIGS.map(cfg => {
          const d = summary[cfg.key] || {
            avgWait: 0, avgTurnaround: 0, avgResponse: 0, jainsFairness: 0, starvationCount: 0
          };
          const bg = cfg.highlight ? 'style="background: rgba(0, 240, 255, 0.04);"' : '';

          return `
            <tr ${bg}>
              <td><strong>${cfg.label}</strong></td>
              <td>${d.avgWait.toFixed(1)}</td>
              <td>${d.avgTurnaround.toFixed(1)}</td>
              <td>${d.avgResponse.toFixed(1)}</td>
              <td>${d.jainsFairness.toFixed(3)}</td>
              <td>${d.starvationCount.toFixed(0)}</td>
              <td><span class="badge ${cfg.badge}">${cfg.tag}</span></td>
            </tr>
          `;
        }).join('');
      }
    }
  };

})(window);
