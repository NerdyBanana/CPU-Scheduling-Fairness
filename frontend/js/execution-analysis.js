/**
 * execution-analysis.js — Unified CPU Execution Timeline & Process Explanation Controller
 * CPU Scheduling Analyzer (Phase 1 Baseline)
 * 
 * Combines Gantt timeline visualization with interactive process explanation:
 * - Single source of truth: executes POST /api/simulate on FastAPI backend
 * - Preserves every separate execution slice and preemption for RR and SRTF
 * - Interactive Gantt click selection with process slice highlighting
 * - Dynamic "Why Did This Process Run?" algorithmic explanation based on authentic data
 * - Chronological unmerged execution interval breakdown
 * - 10-column sortable process table with starvation badges & CSV export
 * - Zero duplicated scheduling logic in JavaScript
 */

(function (window) {
  'use strict';

  // Process Color Palette for Slices
  const PROCESS_COLORS = {
    'P1': '#00f0ff',
    'P2': '#38bdf8',
    'P3': '#22c55e',
    'P4': '#f59e0b',
    'P5': '#c084fc',
    'P6': '#f43f5e',
    'P7': '#e879f9',
    'P8': '#34d399',
    'P9': '#fb923c',
    'P10': '#60a5fa',
    'P11': '#a78bfa',
    'P12': '#4ade80'
  };

  const DEFAULT_PROCESS_COLOR = '#94a3b8';

  function getProcessColor(pid) {
    if (PROCESS_COLORS[pid]) return PROCESS_COLORS[pid];
    // Deterministic color assignment for P13+
    const num = parseInt(String(pid).replace(/\D/g, ''), 10) || 1;
    const hue = (num * 137.508) % 360;
    return `hsl(${hue}, 75%, 60%)`;
  }

  window.ExecutionAnalysisController = {
    activeAlgorithm: 'SRTF',
    activeWorkload: 'normal',
    activeSeed: 0,
    activeQuantum: 2,
    selectedPid: 'P1',
    sortKey: 'pid',
    sortDir: 'asc',

    isLive: false,
    currentProcesses: [],
    currentSlices: [],
    currentMetrics: {},

    mount: function () {
      console.log('[ExecutionAnalysis] Mounting Execution Analysis module...');

      // Sync active workload from WorkloadManager if available
      if (window.WorkloadManager) {
        const wm = window.WorkloadManager.getState();
        if (wm.workloadType && wm.workloadType !== 'custom') {
          this.activeWorkload = wm.workloadType;
          this.activeSeed = wm.seed || 0;
        }
      }

      this.bindControls();
      this.refreshData();
    },

    bindControls: function () {
      // Algorithm Selector
      const selectAlgo = document.getElementById('select-exec-algo');
      if (selectAlgo) {
        selectAlgo.value = this.activeAlgorithm;
        selectAlgo.onchange = (e) => {
          this.activeAlgorithm = e.target.value;
          this.toggleQuantumControl();
          this.refreshData();
        };
      }

      // Workload Selector
      const selectWorkload = document.getElementById('select-exec-workload');
      if (selectWorkload) {
        selectWorkload.value = this.activeWorkload;
        selectWorkload.onchange = (e) => {
          this.activeWorkload = e.target.value;
          this.refreshData();
        };
      }

      // Seed Selector
      const selectSeed = document.getElementById('select-exec-seed');
      if (selectSeed) {
        selectSeed.value = this.activeSeed;
        selectSeed.onchange = (e) => {
          this.activeSeed = parseInt(e.target.value, 10) || 0;
          this.refreshData();
        };
      }

      // Time Quantum Input (for Round Robin)
      const inputQuantum = document.getElementById('input-exec-quantum');
      if (inputQuantum) {
        inputQuantum.value = this.activeQuantum;
        inputQuantum.onchange = (e) => {
          this.activeQuantum = Math.max(1, parseInt(e.target.value, 10) || 2);
          this.refreshData();
        };
      }

      // Reset View Button
      const btnResetView = document.getElementById('btn-exec-reset-view');
      if (btnResetView) {
        btnResetView.onclick = () => {
          const container = document.getElementById('gantt-chart-display');
          if (container && typeof Plotly !== 'undefined') {
            Plotly.relayout(container, {
              'xaxis.autorange': true,
              'yaxis.autorange': true
            });
          }
        };
      }

      // Export CSV Button
      const btnExport = document.getElementById('btn-exec-export-csv');
      if (btnExport) {
        btnExport.onclick = () => this.exportCSV();
      }

      // Sortable Table Headers
      document.querySelectorAll('.process-table th.sortable').forEach(th => {
        th.onclick = () => {
          const col = th.getAttribute('data-col');
          if (!col) return;
          if (this.sortKey === col) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            this.sortKey = col;
            this.sortDir = 'asc';
          }
          document.querySelectorAll('.process-table th.sortable').forEach(h => {
            h.classList.remove('active-sort', 'sort-asc', 'sort-desc');
          });
          th.classList.add('active-sort', this.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
          this.renderProcessTable();
        };
      });

      this.toggleQuantumControl();
    },

    toggleQuantumControl: function () {
      const qBox = document.getElementById('exec-quantum-box');
      if (qBox) {
        if (this.activeAlgorithm === 'RR') {
          qBox.style.display = 'flex';
        } else {
          qBox.style.display = 'none';
        }
      }
    },

    /**
     * Executes single authoritative POST /api/simulate to fetch both slices and process table
     */
    refreshData: async function (overrideAlgo, overrideWl, overrideSeed, overrideQ) {
      const a = overrideAlgo || this.activeAlgorithm;
      const w = overrideWl || this.activeWorkload;
      const s = (overrideSeed !== undefined) ? overrideSeed : this.activeSeed;
      const q = (overrideQ !== undefined) ? overrideQ : this.activeQuantum;

      this.activeAlgorithm = a;
      this.activeWorkload = w;
      this.activeSeed = s;
      this.activeQuantum = q;

      const infoBadge = document.getElementById('exec-status-badge');
      if (infoBadge) {
        infoBadge.textContent = 'Simulating...';
        infoBadge.style.display = 'inline-block';
        infoBadge.className = 'badge badge-primary';
      }

      const apiAlgoKey = (a === 'Round Robin') ? 'RR' : a;
      let loaded = false;

      // 1. Fetch live execution results from FastAPI backend
      if (window.SchedulerAPI && typeof window.SchedulerAPI.simulate === 'function') {
        try {
          const res = await window.SchedulerAPI.simulate({
            workload: w,
            seed: s,
            algorithms: [apiAlgoKey],
            quantum: q
          });

          if (res && res.status === 'success' && res.results && res.results[apiAlgoKey]) {
            const data = res.results[apiAlgoKey];
            this.currentProcesses = (data.processes || []).map(p => ({
              pid: p.PID || p.pid,
              PID: p.PID || p.pid,
              arrival: Number(p.Arrival_Time !== undefined ? p.Arrival_Time : p.arrival) || 0,
              Arrival_Time: Number(p.Arrival_Time !== undefined ? p.Arrival_Time : p.arrival) || 0,
              burst: Number(p.Burst_Time !== undefined ? p.Burst_Time : p.burst) || 0,
              Burst_Time: Number(p.Burst_Time !== undefined ? p.Burst_Time : p.burst) || 0,
              priority: Number(p.Priority !== undefined ? p.Priority : p.priority) || 1,
              Priority: Number(p.Priority !== undefined ? p.Priority : p.priority) || 1,
              start: Number(p.Start_Time !== undefined ? p.Start_Time : p.start) || 0,
              Start_Time: Number(p.Start_Time !== undefined ? p.Start_Time : p.start) || 0,
              completion: Number(p.Completion_Time !== undefined ? p.Completion_Time : p.completion) || 0,
              Completion_Time: Number(p.Completion_Time !== undefined ? p.Completion_Time : p.completion) || 0,
              waiting: Number(p.Waiting_Time !== undefined ? p.Waiting_Time : p.waiting) || 0,
              Waiting_Time: Number(p.Waiting_Time !== undefined ? p.Waiting_Time : p.waiting) || 0,
              turnaround: Number(p.Turnaround_Time !== undefined ? p.Turnaround_Time : p.turnaround) || 0,
              Turnaround_Time: Number(p.Turnaround_Time !== undefined ? p.Turnaround_Time : p.turnaround) || 0,
              response: Number(p.Response_Time !== undefined ? p.Response_Time : p.response) || 0,
              Response_Time: Number(p.Response_Time !== undefined ? p.Response_Time : p.response) || 0,
              starved: Boolean(p.Starved || p.starved),
              Starved: Boolean(p.Starved || p.starved)
            }));

            this.currentSlices = (data.slices || []).map(sl => ({
              pid: sl.PID || sl.pid,
              PID: sl.PID || sl.pid,
              start: Number(sl.start),
              end: Number(sl.end),
              duration: Number(sl.duration)
            }));

            this.currentMetrics = data.metrics || {};
            this.isLive = true;
            loaded = true;

            if (infoBadge) {
              // Hide live badge during normal successful operation
              infoBadge.style.display = 'none';
            }
            console.log(`[ExecutionAnalysis] Loaded ${this.currentProcesses.length} processes & ${this.currentSlices.length} slices for ${a}`);
          }
        } catch (err) {
          console.warn('[ExecutionAnalysis] Live backend error, falling back to cache:', err.message);
        }
      }

      // 2. Offline Fallback if backend is unavailable
      if (!loaded) {
        this.isLive = false;
        this.loadOfflineFallback(w, s, apiAlgoKey);
        if (infoBadge) {
          infoBadge.textContent = '⚠ Backend Offline (Reference Data)';
          infoBadge.className = 'badge badge-danger';
          infoBadge.style.display = 'inline-block';
        }
      }

      // Ensure a valid process is selected
      if (!this.selectedPid || !this.currentProcesses.some(p => p.PID === this.selectedPid)) {
        this.selectedPid = this.currentProcesses[0] ? this.currentProcesses[0].PID : 'P1';
      }

      // Render all views from the exact same data source
      this.renderKPIs();
      this.renderGanttChart();
      this.renderProcessExplanation();
      this.renderProcessTable();
    },

    loadOfflineFallback: function (w, s, a) {
      const wKey = String(w).toLowerCase();
      const sKey = String(s);

      // Load cached slices
      if (window.BENCHMARK_DATA && window.BENCHMARK_DATA.gantt_slices &&
          window.BENCHMARK_DATA.gantt_slices[wKey] &&
          window.BENCHMARK_DATA.gantt_slices[wKey][sKey] &&
          window.BENCHMARK_DATA.gantt_slices[wKey][sKey][a]) {
        this.currentSlices = window.BENCHMARK_DATA.gantt_slices[wKey][sKey][a].map(sl => ({
          pid: sl.PID || sl.pid,
          PID: sl.PID || sl.pid,
          start: sl.start,
          end: sl.end,
          duration: sl.duration
        }));
      } else {
        this.currentSlices = [];
      }

      // Load cached processes
      if (window.PROCESS_DATA && window.PROCESS_DATA[wKey] &&
          window.PROCESS_DATA[wKey][sKey] && window.PROCESS_DATA[wKey][sKey][a]) {
        this.currentProcesses = window.PROCESS_DATA[wKey][sKey][a].map(p => ({
          ...p,
          PID: p.PID || p.pid,
          pid: p.PID || p.pid,
          Arrival_Time: p.Arrival_Time !== undefined ? p.Arrival_Time : p.arrival,
          Burst_Time: p.Burst_Time !== undefined ? p.Burst_Time : p.burst,
          Priority: p.Priority !== undefined ? p.Priority : p.priority,
          Start_Time: p.Start_Time !== undefined ? p.Start_Time : p.start,
          Completion_Time: p.Completion_Time !== undefined ? p.Completion_Time : p.completion,
          Waiting_Time: p.Waiting_Time !== undefined ? p.Waiting_Time : p.waiting,
          Turnaround_Time: p.Turnaround_Time !== undefined ? p.Turnaround_Time : p.turnaround,
          Response_Time: p.Response_Time !== undefined ? p.Response_Time : p.response,
          Starved: Boolean(p.Starved || p.starved)
        }));
      } else {
        this.currentProcesses = [];
      }

      // Estimate metrics
      const waits = this.currentProcesses.map(p => p.Waiting_Time || 0);
      const avgWait = waits.length > 0 ? (waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
      const threshold = 2 * avgWait;
      const starvedCount = this.currentProcesses.filter(p => p.Waiting_Time > threshold).length;

      this.currentMetrics = {
        Avg_Waiting_Time: avgWait,
        Starvation_Threshold: threshold,
        Starvation_Count: starvedCount,
        Jains_Fairness_Index: 0.75
      };
    },

    renderKPIs: function () {
      const m = this.currentMetrics;
      const elWait = document.getElementById('exec-kpi-avg-wait');
      const elTurn = document.getElementById('exec-kpi-avg-turn');
      const elResp = document.getElementById('exec-kpi-avg-resp');
      const elFair = document.getElementById('exec-kpi-fairness');
      const elStarve = document.getElementById('exec-kpi-starve');

      if (elWait && m.Avg_Waiting_Time !== undefined) elWait.textContent = m.Avg_Waiting_Time.toFixed(1) + ' ms';
      if (elTurn && m.Avg_Turnaround_Time !== undefined) elTurn.textContent = m.Avg_Turnaround_Time.toFixed(1) + ' ms';
      if (elResp && m.Avg_Response_Time !== undefined) elResp.textContent = m.Avg_Response_Time.toFixed(1) + ' ms';
      if (elFair && m.Jains_Fairness_Index !== undefined) elFair.textContent = m.Jains_Fairness_Index.toFixed(3);
      if (elStarve && m.Starvation_Count !== undefined) {
        const thresh = (m.Starvation_Threshold !== undefined)
          ? m.Starvation_Threshold.toFixed(1)
          : ((2 * (m.Avg_Waiting_Time || 0)).toFixed(1));
        elStarve.innerHTML = `${m.Starvation_Count} <span style="font-size:12px; color:var(--text-secondary)">(Thresh: ${thresh}ms)</span>`;
      }
    },

    /**
     * Renders CPU Execution Timeline in Plotly, preserving every unmerged slice
     */
    renderGanttChart: function () {
      const container = document.getElementById('gantt-chart-display');
      if (!container || typeof Plotly === 'undefined') return;

      const slices = this.currentSlices;
      if (slices.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);">No execution slices available for current selection.</div>`;
        return;
      }

      // Group slices by distinct process
      const uniquePids = [...new Set(slices.map(sl => sl.PID || sl.pid))];
      // Sort PIDs numerically (P1, P2, P3...)
      uniquePids.sort((a, b) => {
        const numA = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });

      const traces = [];

      uniquePids.forEach(pid => {
        const procSlices = slices.filter(s => (s.PID || s.pid) === pid);
        const isSelected = (pid === this.selectedPid);
        const color = getProcessColor(pid);

        const xDurations = procSlices.map(s => s.duration);
        const baseStarts = procSlices.map(s => s.start);
        const customData = procSlices.map(s => ({
          pid: pid,
          start: s.start,
          end: s.end,
          duration: s.duration,
          mode: this.activeAlgorithm
        }));

        traces.push({
          name: pid,
          type: 'bar',
          orientation: 'h',
          y: procSlices.map(() => 'CPU 1'),
          x: xDurations,
          base: baseStarts,
          customdata: customData,
          width: 0.6,
          text: procSlices.map(s => `${pid} (${s.duration}ms)`),
          textposition: 'inside',
          insidetextanchor: 'middle',
          marker: {
            color: color,
            opacity: isSelected ? 1.0 : (this.selectedPid ? 0.45 : 0.9),
            line: {
              color: isSelected ? '#ffffff' : 'rgba(15, 23, 42, 0.8)',
              width: isSelected ? 2.5 : 1
            }
          },
          hovertemplate:
            '<b>Process %{customdata.pid}</b><br>' +
            'Interval: %{base} ms → %{customdata.end} ms<br>' +
            'Duration: %{x} ms<br>' +
            '<span style="font-size:10px; color:#38bdf8;">Click bar to inspect process details</span>' +
            '<extra></extra>'
        });
      });

      const maxTime = Math.max(...slices.map(s => s.end), 10);

      const layout = {
        barmode: 'overlay',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(10, 17, 34, 0.45)',
        font: {
          family: "'Inter', -apple-system, sans-serif",
          color: '#94a3b8',
          size: 11
        },
        margin: { t: 20, r: 24, l: 70, b: 45 },
        xaxis: {
          title: 'Timeline (ms)',
          range: [0, maxTime + 2],
          gridcolor: 'rgba(56, 189, 248, 0.08)',
          zerolinecolor: 'rgba(56, 189, 248, 0.25)',
          tickfont: { color: '#cbd5e1', size: 11 }
        },
        yaxis: {
          showgrid: false,
          tickfont: { color: '#38bdf8', size: 12, weight: 600 }
        },
        showlegend: true,
        legend: {
          orientation: 'h',
          x: 0,
          y: 1.25,
          font: { color: '#cbd5e1', size: 11 }
        }
      };

      const config = {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d']
      };

      Plotly.newPlot(container, traces, layout, config).then(() => {
        // Bind click event on Plotly bars to select process (bound once per container)
        if (!container._plotlyClickBound) {
          container.on('plotly_click', (eventData) => {
            if (eventData && eventData.points && eventData.points.length > 0) {
              const pt = eventData.points[0];
              const clickedPid = pt.customdata && (pt.customdata.pid || pt.customdata.PID);
              if (clickedPid) {
                window.ExecutionAnalysisController.selectProcess(clickedPid);
              }
            }
          });
          container._plotlyClickBound = true;
        }
      });
    },

    /**
     * Updates selected process and refreshes details and highlighting
     */
    selectProcess: function (pid) {
      this.selectedPid = pid;
      const container = document.getElementById('gantt-chart-display');
      if (container && container.data && typeof Plotly !== 'undefined') {
        const opacities = container.data.map(tr => (tr.name === pid ? 1.0 : 0.45));
        const lineColors = container.data.map(tr => (tr.name === pid ? '#ffffff' : 'rgba(15, 23, 42, 0.8)'));
        const lineWidths = container.data.map(tr => (tr.name === pid ? 2.5 : 1));
        Plotly.restyle(container, {
          'marker.opacity': opacities,
          'marker.line.color': lineColors,
          'marker.line.width': lineWidths
        });
      } else {
        this.renderGanttChart();
      }
      this.renderProcessExplanation();
      this.highlightTableRow();
    },

    /**
     * Renders "Why Did This Process Run?" and execution interval breakdown
     */
    renderProcessExplanation: function () {
      const container = document.getElementById('process-explanation-card');
      if (!container) return;

      const p = this.currentProcesses.find(proc => proc.PID === this.selectedPid) || this.currentProcesses[0];
      if (!p) {
        container.innerHTML = `<div style="color:var(--text-muted); padding:20px;">No process selected.</div>`;
        return;
      }

      const procSlices = this.currentSlices.filter(sl => (sl.PID || sl.pid) === p.PID);
      const color = getProcessColor(p.PID);
      const isStarved = Boolean(p.Starved);
      const threshold = (this.currentMetrics.Starvation_Threshold !== undefined)
        ? this.currentMetrics.Starvation_Threshold
        : (2 * (this.currentMetrics.Avg_Waiting_Time || 0));

      // Generate dynamic algorithmic explanation based on authentic timings
      let reasonText = '';
      const algo = this.activeAlgorithm;

      if (algo === 'FCFS') {
        reasonText = `Process <strong>${p.PID}</strong> arrived at <strong>t = ${p.Arrival_Time} ms</strong> and was dispatched at <strong>t = ${p.Start_Time} ms</strong> according to strict FIFO arrival order. As FCFS is non-preemptive, once allocated CPU 1 it ran continuously for its entire <strong>${p.Burst_Time} ms</strong> burst until terminating at <strong>t = ${p.Completion_Time} ms</strong>.`;
      } else if (algo === 'SJF') {
        reasonText = `Process <strong>${p.PID}</strong> was dispatched at <strong>t = ${p.Start_Time} ms</strong> because it had the shortest CPU burst (<strong>${p.Burst_Time} ms</strong>) among all ready processes present in the queue at that time. It executed non-preemptively to completion at <strong>t = ${p.Completion_Time} ms</strong>.`;
      } else if (algo === 'SRTF') {
        if (procSlices.length > 1) {
          reasonText = `Process <strong>${p.PID}</strong> (burst: <strong>${p.Burst_Time} ms</strong>) was selected whenever its remaining burst was the shortest among all arrived ready processes. During execution, it was preempted <strong>${procSlices.length - 1} time(s)</strong> when newly arriving tasks presented shorter remaining bursts, executing across <strong>${procSlices.length} slices</strong> until finishing at <strong>t = ${p.Completion_Time} ms</strong>.`;
        } else {
          reasonText = `Process <strong>${p.PID}</strong> was dispatched at <strong>t = ${p.Start_Time} ms</strong> because it had the shortest remaining burst time (<strong>${p.Burst_Time} ms</strong>). It ran to completion without preemption because no newly arriving task had a shorter burst.`;
        }
      } else if (algo === 'RR') {
        reasonText = `Process <strong>${p.PID}</strong> was allocated the CPU in cyclic FIFO order for up to the time quantum (<strong>q = ${this.activeQuantum} ms</strong>). Because its total burst is <strong>${p.Burst_Time} ms</strong>, it required <strong>${procSlices.length} time slice(s)</strong>. After each non-terminating slice, it yielded CPU 1 and returned to the ready queue tail.`;
      } else if (algo === 'Priority' || algo === 'PRIORITY') {
        reasonText = `Process <strong>${p.PID}</strong> was dispatched at <strong>t = ${p.Start_Time} ms</strong> because it held the highest priority class (<strong>Priority: ${p.Priority}</strong>, where lower numeric values denote higher priority) among arrived ready tasks. It ran non-preemptively to completion at <strong>t = ${p.Completion_Time} ms</strong>.`;
      }

      // Starvation note if applicable
      let starveWarning = '';
      if (isStarved) {
        starveWarning = `
          <div class="starvation-notice-box">
            <strong>⚠ Starvation Condition Breached:</strong> Process ${p.PID}'s waiting time of <strong>${p.Waiting_Time} ms</strong> exceeded twice the system average (Threshold: <strong>${threshold.toFixed(1)} ms</strong>). Under ${algo}, it suffered prolonged ready-queue postponement while shorter or higher priority tasks monopolized the CPU.
          </div>
        `;
      }

      // Slice interval chips
      const sliceIntervalsHtml = procSlices.length > 0
        ? procSlices.map((sl, idx) => `
            <div class="exec-slice-chip">
              <span class="slice-index">#${idx + 1}</span>
              <span class="slice-times">${sl.start}–${sl.end} ms</span>
              <span class="slice-dur">(${sl.duration} ms)</span>
            </div>
          `).join('')
        : `<span style="color:var(--text-muted)">No execution slices recorded.</span>`;

      container.innerHTML = `
        <div class="process-detail-header">
          <div style="display:flex; align-items:center; gap:12px;">
            <span class="process-pid-badge" style="background:${color}22; color:${color}; border:1px solid ${color}66;">
              ${p.PID}
            </span>
            <div>
              <h3 style="margin:0; font-size:16px; color:#ffffff;">Process ${p.PID} Scheduling Analysis</h3>
              <div style="font-size:12px; color:var(--text-muted);">${algo} • ${this.activeWorkload.toUpperCase()} (Seed ${this.activeSeed})</div>
            </div>
          </div>
          <div>
            ${isStarved 
              ? `<span class="badge badge-danger">● Starved (${p.Waiting_Time}ms > ${threshold.toFixed(1)}ms)</span>` 
              : `<span class="badge badge-success">✓ Completed (${p.Waiting_Time}ms ≤ ${threshold.toFixed(1)}ms)</span>`
            }
          </div>
        </div>

        <div class="process-metrics-grid">
          <div class="proc-metric-cell"><span class="lbl">Arrival:</span> <strong>${p.Arrival_Time} ms</strong></div>
          <div class="proc-metric-cell"><span class="lbl">Burst Time:</span> <strong>${p.Burst_Time} ms</strong></div>
          <div class="proc-metric-cell"><span class="lbl">Priority:</span> <strong>${p.Priority}</strong></div>
          <div class="proc-metric-cell"><span class="lbl">First Start:</span> <strong>${p.Start_Time} ms</strong></div>
          <div class="proc-metric-cell"><span class="lbl">Completion:</span> <strong>${p.Completion_Time} ms</strong></div>
          <div class="proc-metric-cell"><span class="lbl">Waiting Time:</span> <strong style="color:${isStarved ? '#fb7185' : 'var(--accent-cyan)'}">${p.Waiting_Time} ms</strong></div>
          <div class="proc-metric-cell"><span class="lbl">Turnaround:</span> <strong>${p.Turnaround_Time} ms</strong></div>
          <div class="proc-metric-cell"><span class="lbl">Response Time:</span> <strong>${p.Response_Time} ms</strong></div>
        </div>

        <div class="explanation-text-block">
          <div class="explanation-title">💡 Why Did This Process Run?</div>
          <p class="explanation-paragraph">${reasonText}</p>
          ${starveWarning}
        </div>

        <div class="execution-slices-block">
          <div class="slices-block-title">
            <span>Execution Intervals Breakdown</span>
            <span class="slices-count-pill">${procSlices.length} unmerged slice(s) • Total: ${p.Burst_Time} ms</span>
          </div>
          <div class="slices-chips-container">
            ${sliceIntervalsHtml}
          </div>
        </div>
      `;
    },

    /**
     * Renders 10-column process table
     */
    renderProcessTable: function () {
      const tbody = document.getElementById('exec-process-table-body');
      if (!tbody) return;

      const procs = [...this.currentProcesses];
      if (procs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:30px; color:var(--text-muted)">No process data available.</td></tr>`;
        return;
      }

      // Sort
      const key = this.sortKey;
      const dir = this.sortDir === 'asc' ? 1 : -1;
      procs.sort((a, b) => {
        let valA = a[key] !== undefined ? a[key] : a[key.toLowerCase()];
        let valB = b[key] !== undefined ? b[key] : b[key.toLowerCase()];
        if (key === 'pid' || key === 'PID') {
          const nA = parseInt(String(valA).replace(/\D/g, ''), 10) || 0;
          const nB = parseInt(String(valB).replace(/\D/g, ''), 10) || 0;
          return (nA - nB) * dir;
        }
        if (typeof valA === 'boolean') {
          valA = valA ? 1 : 0;
          valB = valB ? 1 : 0;
        }
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
      });

      tbody.innerHTML = procs.map(p => {
        const isSelected = (p.PID === this.selectedPid);
        const color = getProcessColor(p.PID);
        const isStarved = Boolean(p.Starved);

        return `
          <tr class="${isSelected ? 'selected-row' : ''}" style="cursor:pointer;" onclick="window.ExecutionAnalysisController.selectProcess('${p.PID}')">
            <td><strong style="color:${color}">${p.PID}</strong></td>
            <td>${p.Arrival_Time}</td>
            <td>${p.Burst_Time}</td>
            <td>${p.Priority}</td>
            <td>${p.Start_Time}</td>
            <td>${p.Completion_Time}</td>
            <td><strong style="color:${isStarved ? '#fb7185' : 'inherit'}">${p.Waiting_Time}</strong></td>
            <td>${p.Turnaround_Time}</td>
            <td>${p.Response_Time}</td>
            <td>
              ${isStarved 
                ? `<span class="badge-starved">● STARVED</span>` 
                : `<span class="badge-not-starved">✓ Completed</span>`
              }
            </td>
          </tr>
        `;
      }).join('');
    },

    highlightTableRow: function () {
      document.querySelectorAll('#exec-process-table-body tr').forEach(row => {
        const pidCell = row.querySelector('td:first-child');
        if (pidCell && pidCell.textContent.trim() === this.selectedPid) {
          row.classList.add('selected-row');
        } else {
          row.classList.remove('selected-row');
        }
      });
    },

    exportCSV: function () {
      if (this.currentProcesses.length === 0) return;

      const headers = ['PID', 'Arrival_Time', 'Burst_Time', 'Priority', 'Start_Time', 'Completion_Time', 'Waiting_Time', 'Turnaround_Time', 'Response_Time', 'Starved'];
      const rows = this.currentProcesses.map(p => [
        p.PID, p.Arrival_Time, p.Burst_Time, p.Priority, p.Start_Time, p.Completion_Time, p.Waiting_Time, p.Turnaround_Time, p.Response_Time, p.Starved ? 'TRUE' : 'FALSE'
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `execution_${this.activeAlgorithm}_${this.activeWorkload}_seed${this.activeSeed}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },

    // Backward compatibility methods for testing
    renderGantt: function (w, s, a, q) {
      return this.refreshData(a, w, s, q);
    },

    fetchAnalysisData: function (q) {
      return this.refreshData(this.activeAlgorithm, this.activeWorkload, this.activeSeed, q);
    },

    getProcesses: function () {
      return this.currentProcesses;
    },

    getActiveProcesses: function () {
      return this.currentProcesses;
    },

    getActiveMetrics: function () {
      return this.currentMetrics;
    }
  };

  // Aliases ensuring existing references work without error
  window.GanttController = window.ExecutionAnalysisController;
  window.AnalysisController = window.ExecutionAnalysisController;

})(window);
