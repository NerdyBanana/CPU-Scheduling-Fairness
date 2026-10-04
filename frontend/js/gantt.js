/**
 * gantt.js — Interactive Gantt Execution Timeline Controller
 * CPU Scheduling Analyzer (Phase 1 Baseline)
 * 
 * Connected to live FastAPI backend (POST /api/simulate):
 * - Uses the authentic execution slices computed by the Python engine
 * - Preserves every separate execution slice and preemption for RR and SRTF
 * - Displays contiguous execution intervals for FCFS, SJF, and Priority
 * - Interactive controls: Algorithm selection, Workload, Seed, Zoom/Pan, and Reset View.
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

  window.GanttController = {
    activeAlgorithm: 'RR',
    activeWorkload: 'normal',
    activeSeed: 0,
    activeQuantum: 2,
    isLive: false,
    currentSlices: [],

    mount: function () {
      console.log('[GanttController] Mounting Interactive Gantt Timeline...');

      // Sync active workload from WorkloadManager if available
      if (window.WorkloadManager) {
        const wm = window.WorkloadManager.getState();
        if (wm.workloadType && wm.workloadType !== 'custom') {
          this.activeWorkload = wm.workloadType;
          this.activeSeed = wm.seed || 0;
        }
      }

      this.bindControls();
      this.renderGantt();
    },

    bindControls: function () {
      // Algorithm Selector Buttons
      document.querySelectorAll('.gantt-algo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const algo = btn.getAttribute('data-algo');
          if (algo) {
            this.activeAlgorithm = algo;
            document.querySelectorAll('.gantt-algo-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.renderGantt();
          }
        });
      });

      // Workload Selector
      const selectWorkload = document.getElementById('select-gantt-workload');
      if (selectWorkload) {
        selectWorkload.value = this.activeWorkload;
        selectWorkload.addEventListener('change', (e) => {
          this.activeWorkload = e.target.value;
          this.renderGantt();
        });
      }

      // Seed Selector
      const selectSeed = document.getElementById('select-gantt-seed');
      if (selectSeed) {
        selectSeed.value = this.activeSeed;
        selectSeed.addEventListener('change', (e) => {
          this.activeSeed = parseInt(e.target.value, 10) || 0;
          this.renderGantt();
        });
      }

      // Reset View Button
      const btnResetView = document.getElementById('btn-gantt-reset-view');
      if (btnResetView) {
        btnResetView.addEventListener('click', () => {
          const container = document.getElementById('gantt-chart-display');
          if (container && typeof Plotly !== 'undefined') {
            Plotly.relayout(container, {
              'xaxis.autorange': true,
              'yaxis.autorange': true
            });
          }
        });
      }
    },

    /**
     * Retrieves cached execution slices from window.BENCHMARK_DATA for offline fallback
     */
    getCachedSlices: function (workload, seed, algorithm) {
      if (!window.BENCHMARK_DATA || !window.BENCHMARK_DATA.gantt_slices) {
        return null;
      }

      const w = String(workload).toLowerCase();
      const s = parseInt(seed, 10) || 0;
      let a = algorithm;
      if (a === 'Round Robin') a = 'RR';

      if (window.BENCHMARK_DATA.gantt_slices[w] &&
          window.BENCHMARK_DATA.gantt_slices[w][s] &&
          window.BENCHMARK_DATA.gantt_slices[w][s][a]) {
        return window.BENCHMARK_DATA.gantt_slices[w][s][a];
      }

      return null;
    },

    /**
     * Renders Plotly Gantt chart and detailed slices breakdown table
     */
    renderGantt: async function (workload, seed, algorithm, quantum) {
      const w = workload || this.activeWorkload;
      const s = (seed !== undefined) ? seed : this.activeSeed;
      const a = algorithm || this.activeAlgorithm;
      const q = (quantum !== undefined) ? quantum : (this.activeQuantum || 2);
      this.activeQuantum = q;

      const container = document.getElementById('gantt-chart-display');
      const tableBody = document.getElementById('gantt-slices-table-body');
      const infoBadge = document.getElementById('gantt-active-meta-badge');

      if (infoBadge) {
        infoBadge.textContent = `${a} • ${w.toUpperCase()} (Seed ${s}) [⟳ Simulating...]`;
        infoBadge.className = 'badge badge-primary';
        infoBadge.style.background = '';
        infoBadge.style.color = '';
      }

      let slices = null;
      let isLive = false;

      // 1. Fetch live execution slices from FastAPI backend
      if (window.SchedulerAPI && typeof window.SchedulerAPI.simulate === 'function') {
        try {
          const apiAlgoKey = (a === 'Round Robin') ? 'RR' : a;
          const res = await window.SchedulerAPI.simulate({
            workload: w,
            seed: s,
            algorithms: [apiAlgoKey],
            quantum: q
          });

          if (res && res.status === 'success' && res.results && res.results[apiAlgoKey]) {
            const algoResult = res.results[apiAlgoKey];
            if (Array.isArray(algoResult.slices) && algoResult.slices.length > 0) {
              slices = algoResult.slices.map(sl => ({
                pid: sl.PID || sl.pid,
                PID: sl.PID || sl.pid,
                start: sl.start,
                end: sl.end,
                duration: sl.duration
              }));
              isLive = true;
              console.log(`[Gantt] Received ${slices.length} live execution slices from Python backend for ${a}`);
            }
          }
        } catch (err) {
          console.warn('[Gantt] Live backend fetch error, falling back to cache:', err.message);
        }
      }

      // 2. Fallback to precompiled benchmark data if backend is unavailable
      if (!slices || !isLive) {
        slices = this.getCachedSlices(w, s, a);
        this.isLive = false;
        if (infoBadge) {
          infoBadge.textContent = `${a} • ${w.toUpperCase()} (Seed ${s}) [⚠ Backend Offline - Reference Fallback]`;
          infoBadge.className = 'badge';
          infoBadge.style.background = '#f43f5e';
          infoBadge.style.color = '#fff';
        }
      } else {
        this.isLive = true;
        if (infoBadge) {
          infoBadge.textContent = `${a} • ${w.toUpperCase()} (Seed ${s}) [● Live Python Backend]`;
          infoBadge.className = 'badge badge-success';
          infoBadge.style.background = '#22c55e';
          infoBadge.style.color = '#050a14';
        }
      }

      this.currentSlices = slices || [];

      if (!slices || slices.length === 0) {
        if (container) {
          container.innerHTML = `
            <div class="chart-empty-state">
              <div class="chart-empty-icon">⏱️</div>
              <div class="chart-empty-title">Execution Timeline Slices</div>
              <div class="chart-empty-desc">No execution slices found for ${w} seed ${s} (${a}).</div>
            </div>
          `;
        }
        if (tableBody) tableBody.innerHTML = '';
        return;
      }

      // Group slices by unique PID for distinct interactive legend & coloring
      const uniquePids = [...new Set(slices.map(item => item.pid || item.PID))];

      // Build individual Plotly traces per PID
      const traces = [];
      uniquePids.forEach(pid => {
        const pidSlices = slices.filter(item => (item.pid || item.PID) === pid);
        const color = PROCESS_COLORS[pid] || DEFAULT_PROCESS_COLOR;

        traces.push({
          type: 'bar',
          orientation: 'h',
          name: pid,
          y: pidSlices.map(() => 'CPU 1 (Execution Timeline)'),
          base: pidSlices.map(item => item.start),
          x: pidSlices.map(item => item.duration),
          text: pidSlices.map(item => `${item.pid || item.PID} (${item.duration}ms)`),
          textposition: 'inside',
          insidetextanchor: 'middle',
          marker: {
            color: color,
            line: { color: '#070c18', width: 1.5 }
          },
          customdata: pidSlices.map(item => ({
            pid: item.pid || item.PID,
            start: item.start,
            end: item.end,
            duration: item.duration
          })),
          hovertemplate: 
            '<b>Process: %{customdata.pid}</b><br>' +
            'Start Time: %{customdata.start} ms<br>' +
            'End Time: %{customdata.end} ms<br>' +
            'Slice Duration: %{customdata.duration} ms<br>' +
            '<extra></extra>'
        });
      });

      const maxEnd = Math.max(...slices.map(item => item.end));

      const layout = {
        barmode: 'stack',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(10, 17, 34, 0.55)',
        font: {
          family: "'Inter', sans-serif",
          color: '#94a3b8',
          size: 11
        },
        margin: { t: 30, r: 24, l: 140, b: 50 },
        xaxis: {
          title: 'Timeline (ms)',
          gridcolor: 'rgba(56, 189, 248, 0.1)',
          zerolinecolor: 'rgba(56, 189, 248, 0.3)',
          range: [0, Math.ceil(maxEnd * 1.02)],
          tickfont: { color: '#cbd5e1' }
        },
        yaxis: {
          autorange: 'reversed',
          showgrid: false,
          tickfont: { color: '#f8fafc', size: 12, weight: 'bold' }
        },
        legend: {
          orientation: 'h',
          y: 1.18,
          x: 0,
          font: { color: '#f8fafc' },
          bgcolor: 'rgba(15, 24, 44, 0.8)',
          bordercolor: 'rgba(56, 189, 248, 0.2)'
        }
      };

      const config = {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d']
      };

      if (container && typeof Plotly !== 'undefined') {
        Plotly.newPlot(container, traces, layout, config);
      }

      // Render Slices Breakdown Table (displaying first 40 slices for readability)
      if (tableBody) {
        const displaySlices = slices.slice(0, 40);
        tableBody.innerHTML = displaySlices.map((item, idx) => {
          const pid = item.pid || item.PID;
          const color = PROCESS_COLORS[pid] || DEFAULT_PROCESS_COLOR;
          const isPreemptive = (a === 'RR' || a === 'Round Robin' || a === 'SRTF');
          const stateLabel = isPreemptive ? 'Execution Slice' : 'Run to Completion';

          return `
            <tr>
              <td style="font-family:var(--font-mono); color:var(--text-muted);">#${idx + 1}</td>
              <td>
                <span style="display:inline-flex; align-items:center; gap:6px; font-weight:700; color:${color};">
                  <span style="width:8px; height:8px; border-radius:2px; background:${color};"></span>
                  ${pid}
                </span>
              </td>
              <td style="font-family:var(--font-mono);">${item.start} ms</td>
              <td style="font-family:var(--font-mono);">${item.end} ms</td>
              <td style="font-family:var(--font-mono); font-weight:600; color:var(--accent-cyan);">${item.duration} ms</td>
              <td><span class="badge ${isPreemptive ? 'badge-blue' : 'badge-green'}">${stateLabel}</span></td>
            </tr>
          `;
        }).join('');
      }

      console.log(`[Gantt] Rendered ${slices.length} execution slices for ${a} on ${w}_seed${s}`);
    }
  };

})(window);
