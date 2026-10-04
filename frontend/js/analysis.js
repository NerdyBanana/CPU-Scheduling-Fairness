/**
 * analysis.js — Process-Level Analysis & Deep Dive Controller
 * CPU Scheduling Analyzer (Phase 1 Baseline)
 * 
 * Connected to live FastAPI backend (POST /api/simulate):
 * - Granular process metrics table (P1–P25) directly from backend processes
 * - Dynamic Summary KPI cards using backend metrics (Processes, Avg Waiting, Avg Turnaround, Avg Response, Starved)
 * - Interactive Controls (Algorithm pills, Workload dropdown, Seed dropdown)
 * - Multi-column sorting (PID, Arrival, Burst, Priority, Start, Completion, Waiting, Turnaround, Response, Starved)
 * - Starvation visualization (STARVED / NOT STARVED badges, strictly using backend Starved flags)
 * - Process selection & detail card with exact non-merged execution intervals/slices ladder from backend slices
 * - Dynamic browser CSV export using currently active backend data
 * - Zero scheduling or starvation math performed in JavaScript.
 */

(function (window) {
  'use strict';

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

  window.AnalysisController = {
    activeAlgorithm: 'RR',
    activeWorkload: 'normal',
    activeSeed: 0,
    activeQuantum: 2,
    sortKey: 'pid',
    sortDir: 'asc',
    selectedPid: 'P1',
    isLive: false,
    liveProcesses: null,
    liveSlices: null,
    liveMetrics: null,
    sourceDesc: '',

    mount: function () {
      console.log('[AnalysisController] Mounting Process-Level Analysis Module...');

      // Sync active workload from WorkloadManager if available
      if (window.WorkloadManager) {
        const wm = window.WorkloadManager.getState();
        if (wm.workloadType && wm.workloadType !== 'custom') {
          this.activeWorkload = wm.workloadType;
          this.activeSeed = wm.seed || 0;
        }
      }

      this.bindControls();
      this.renderAll();
    },

    bindControls: function () {
      // Algorithm Selector Pills
      document.querySelectorAll('.analysis-algo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const algo = btn.getAttribute('data-algo');
          if (algo && algo !== this.activeAlgorithm) {
            this.activeAlgorithm = algo;
            document.querySelectorAll('.analysis-algo-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.renderAll();
          }
        });
      });

      // Workload Selector
      const selectWorkload = document.getElementById('select-analysis-workload');
      if (selectWorkload) {
        selectWorkload.value = this.activeWorkload;
        selectWorkload.addEventListener('change', (e) => {
          this.activeWorkload = e.target.value;
          this.renderAll();
        });
      }

      // Seed Selector
      const selectSeed = document.getElementById('select-analysis-seed');
      if (selectSeed) {
        selectSeed.value = this.activeSeed;
        selectSeed.addEventListener('change', (e) => {
          this.activeSeed = parseInt(e.target.value, 10) || 0;
          this.renderAll();
        });
      }

      // CSV Export Button
      const btnExport = document.getElementById('btn-export-analysis-csv');
      if (btnExport) {
        btnExport.addEventListener('click', () => {
          this.exportCSV();
        });
      }

      // Table Header Sorting
      document.querySelectorAll('.process-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.getAttribute('data-col');
          if (col) {
            this.toggleSort(col);
          }
        });
      });
    },

    toggleSort: function (columnKey) {
      if (this.sortKey === columnKey) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortKey = columnKey;
        this.sortDir = 'asc';
      }
      this.renderTable();
    },

    /**
     * Fetches live process schedules and slices from FastAPI backend
     */
    fetchAnalysisData: async function (quantum) {
      const w = String(this.activeWorkload).toLowerCase();
      const s = parseInt(this.activeSeed, 10) || 0;
      const a = (this.activeAlgorithm === 'Round Robin') ? 'RR' : this.activeAlgorithm;
      const q = (quantum !== undefined) ? quantum : (this.activeQuantum || 2);
      this.activeQuantum = q;

      const hint = document.querySelector('.analysis-table-hint');
      if (hint) hint.textContent = '⟳ Fetching live process data from Python backend...';

      if (window.SchedulerAPI && typeof window.SchedulerAPI.simulate === 'function') {
        try {
          const res = await window.SchedulerAPI.simulate({
            workload: w,
            seed: s,
            algorithms: [a],
            quantum: q
          });

          if (res && res.status === 'success' && res.results && res.results[a]) {
            const algoData = res.results[a];
            this.liveProcesses = (algoData.processes || []).map(p => ({
              pid: p.PID || p.pid,
              PID: p.PID || p.pid,
              arrival: p.Arrival_Time !== undefined ? p.Arrival_Time : p.arrival,
              Arrival_Time: p.Arrival_Time !== undefined ? p.Arrival_Time : p.arrival,
              burst: p.Burst_Time !== undefined ? p.Burst_Time : p.burst,
              Burst_Time: p.Burst_Time !== undefined ? p.Burst_Time : p.burst,
              priority: p.Priority !== undefined ? p.Priority : p.priority,
              Priority: p.Priority !== undefined ? p.Priority : p.priority,
              start: p.Start_Time !== undefined ? p.Start_Time : p.start,
              Start_Time: p.Start_Time !== undefined ? p.Start_Time : p.start,
              completion: p.Completion_Time !== undefined ? p.Completion_Time : p.completion,
              Completion_Time: p.Completion_Time !== undefined ? p.Completion_Time : p.completion,
              waiting: p.Waiting_Time !== undefined ? p.Waiting_Time : p.waiting,
              Waiting_Time: p.Waiting_Time !== undefined ? p.Waiting_Time : p.waiting,
              turnaround: p.Turnaround_Time !== undefined ? p.Turnaround_Time : p.turnaround,
              Turnaround_Time: p.Turnaround_Time !== undefined ? p.Turnaround_Time : p.turnaround,
              response: p.Response_Time !== undefined ? p.Response_Time : p.response,
              Response_Time: p.Response_Time !== undefined ? p.Response_Time : p.response,
              starved: p.Starved !== undefined ? p.Starved : p.starved,
              Starved: p.Starved !== undefined ? p.Starved : p.starved
            }));

            this.liveSlices = (algoData.slices || []).map(sl => ({
              pid: sl.PID || sl.pid,
              PID: sl.PID || sl.pid,
              start: sl.start,
              end: sl.end,
              duration: sl.duration
            }));

            this.liveMetrics = algoData.metrics;
            this.isLive = true;
            this.sourceDesc = `Live Python Backend (${res.source || `${w}_seed${s}`})`;

            if (hint) {
              hint.innerHTML = `<span style="color:#4ade80; font-weight:600;">● Live Backend</span> (${res.source || `${w}_seed${s}`}) • Click row to inspect`;
            }
            console.log(`[AnalysisController] Loaded ${this.liveProcesses.length} processes from live backend for ${a}`);
            return;
          }
        } catch (err) {
          console.warn('[AnalysisController] Live backend fetch error, falling back to cache:', err.message);
        }
      }

      // Offline fallback
      this.liveProcesses = null;
      this.liveSlices = null;
      this.liveMetrics = null;
      this.isLive = false;
      this.sourceDesc = `Reference Cache (Backend Offline: ${w}_seed${s})`;
      if (hint) {
        hint.innerHTML = `<span style="color:#fb7185; font-weight:600;">⚠ Backend Offline</span> (Reference Cache) • Click row to inspect`;
      }
    },

    getProcesses: function () {
      if (this.isLive && this.liveProcesses) {
        return this.liveProcesses;
      }

      const w = String(this.activeWorkload).toLowerCase();
      const s = String(this.activeSeed);
      const a = (this.activeAlgorithm === 'Round Robin') ? 'RR' : this.activeAlgorithm;

      if (window.PROCESS_DATA && window.PROCESS_DATA[w] && window.PROCESS_DATA[w][s] && window.PROCESS_DATA[w][s][a]) {
        return window.PROCESS_DATA[w][s][a];
      }
      return [];
    },

    getSlices: function (pid) {
      if (this.isLive && this.liveSlices) {
        return this.liveSlices.filter(sl => (sl.pid === pid || sl.PID === pid));
      }

      const w = String(this.activeWorkload).toLowerCase();
      const s = parseInt(this.activeSeed, 10) || 0;
      let a = this.activeAlgorithm;
      if (a === 'Round Robin') a = 'RR';

      if (window.BENCHMARK_DATA &&
          window.BENCHMARK_DATA.gantt_slices &&
          window.BENCHMARK_DATA.gantt_slices[w] &&
          window.BENCHMARK_DATA.gantt_slices[w][s] &&
          window.BENCHMARK_DATA.gantt_slices[w][s][a]) {
        const allSlices = window.BENCHMARK_DATA.gantt_slices[w][s][a];
        return allSlices.filter(sl => (sl.pid === pid || sl.PID === pid));
      }
      return [];
    },

    sortProcesses: function (procs) {
      const sorted = [...procs];
      const key = this.sortKey;
      const dir = this.sortDir === 'asc' ? 1 : -1;

      sorted.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];

        if (key === 'pid') {
          const numA = parseInt(String(valA).replace(/\D/g, ''), 10) || 0;
          const numB = parseInt(String(valB).replace(/\D/g, ''), 10) || 0;
          return (numA - numB) * dir;
        }

        if (typeof valA === 'boolean') {
          valA = valA ? 1 : 0;
          valB = valB ? 1 : 0;
        }

        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
      });

      return sorted;
    },

    renderAll: async function (quantum) {
      await this.fetchAnalysisData(quantum);
      const procs = this.getProcesses();
      this.renderSummaryCards(procs);
      this.renderTable(procs);

      // Default to first process if selectedPid not in dataset
      if (procs.length > 0) {
        const exists = procs.some(p => (p.pid || p.PID) === this.selectedPid);
        if (!exists) {
          this.selectedPid = procs[0].pid || procs[0].PID;
        }
      }
      this.renderDetailCard(this.selectedPid, procs);
    },

    renderSummaryCards: function (procs) {
      const list = procs || this.getProcesses();
      const n = list.length;

      const elTotal = document.getElementById('analysis-kpi-total-procs');
      const elAvgWait = document.getElementById('analysis-kpi-avg-wait');
      const elAvgTurnaround = document.getElementById('analysis-kpi-avg-turnaround');
      const elAvgResponse = document.getElementById('analysis-kpi-avg-response');
      const elStarved = document.getElementById('analysis-kpi-starved-count');
      const elStarveSub = document.getElementById('analysis-kpi-starved-sub');

      if (n === 0) {
        if (elTotal) elTotal.textContent = '0';
        if (elAvgWait) elAvgWait.textContent = 'N/A';
        if (elAvgTurnaround) elAvgTurnaround.textContent = 'N/A';
        if (elAvgResponse) elAvgResponse.textContent = 'N/A';
        if (elStarved) elStarved.textContent = '0';
        return;
      }

      // Use live backend metrics if available (single source of truth)
      if (this.isLive && this.liveMetrics) {
        const m = this.liveMetrics;
        if (elTotal) elTotal.textContent = String(n);
        if (elAvgWait) elAvgWait.innerHTML = `${m.Avg_Waiting_Time.toFixed(2)}<span class="analysis-kpi-unit">ms</span>`;
        if (elAvgTurnaround) elAvgTurnaround.innerHTML = `${m.Avg_Turnaround_Time.toFixed(2)}<span class="analysis-kpi-unit">ms</span>`;
        if (elAvgResponse) elAvgResponse.innerHTML = `${m.Avg_Response_Time.toFixed(2)}<span class="analysis-kpi-unit">ms</span>`;
        if (elStarved) elStarved.textContent = String(m.Starvation_Count);
        if (elStarveSub) {
          elStarveSub.textContent = `Threshold: >${m.Starvation_Threshold} ms (2 × W_avg) [Live Backend]`;
        }
        return;
      }

      // Offline fallback
      const sumWait = list.reduce((acc, p) => acc + (p.waiting !== undefined ? p.waiting : 0), 0);
      const sumTurn = list.reduce((acc, p) => acc + (p.turnaround !== undefined ? p.turnaround : 0), 0);
      const sumResp = list.reduce((acc, p) => acc + (p.response !== undefined ? p.response : 0), 0);
      const starvedCount = list.filter(p => (p.starved === true || p.Starved === true)).length;

      const avgWait = sumWait / n;
      const avgTurn = sumTurn / n;
      const avgResp = sumResp / n;
      const starveThresh = (2.0 * avgWait).toFixed(2);

      if (elTotal) elTotal.textContent = String(n);
      if (elAvgWait) elAvgWait.innerHTML = `${avgWait.toFixed(2)}<span class="analysis-kpi-unit">ms</span>`;
      if (elAvgTurnaround) elAvgTurnaround.innerHTML = `${avgTurn.toFixed(2)}<span class="analysis-kpi-unit">ms</span>`;
      if (elAvgResponse) elAvgResponse.innerHTML = `${avgResp.toFixed(2)}<span class="analysis-kpi-unit">ms</span>`;
      if (elStarved) elStarved.textContent = String(starvedCount);
      if (elStarveSub) {
        elStarveSub.textContent = `Threshold: >${starveThresh} ms (2 × W_avg) [Offline Reference]`;
      }
    },

    renderTable: function (procs) {
      const list = procs || this.getProcesses();
      const sorted = this.sortProcesses(list);
      const tbody = document.getElementById('analysis-table-body');
      if (!tbody) return;

      // Update header sort indicators
      document.querySelectorAll('.process-table th.sortable').forEach(th => {
        const col = th.getAttribute('data-col');
        th.classList.remove('active-sort');
        const indicator = th.querySelector('.sort-indicator');
        if (indicator) indicator.textContent = '↕';

        if (col === this.sortKey) {
          th.classList.add('active-sort');
          if (indicator) {
            indicator.textContent = this.sortDir === 'asc' ? '▲' : '▼';
          }
        }
      });

      if (sorted.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="10" style="text-align:center; padding:32px; color:var(--text-muted);">
              No process data available for ${this.activeWorkload} seed ${this.activeSeed} (${this.activeAlgorithm}).
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = sorted.map(p => {
        const pid = p.pid || p.PID;
        const isSelected = pid === this.selectedPid;
        const color = PROCESS_COLORS[pid] || DEFAULT_PROCESS_COLOR;
        const isStarved = (p.starved === true || p.Starved === true);
        const starveBadge = isStarved
          ? `<span class="badge-starved">● STARVED</span>`
          : `<span class="badge-not-starved">✓ NOT STARVED</span>`;

        return `
          <tr data-pid="${pid}" class="${isSelected ? 'is-selected' : ''}">
            <td>
              <span class="proc-pill">
                <span class="proc-pill-dot" style="background-color:${color};"></span>
                ${pid}
              </span>
            </td>
            <td class="numeric">${p.arrival !== undefined ? p.arrival : p.Arrival_Time}</td>
            <td class="numeric">${p.burst !== undefined ? p.burst : p.Burst_Time}</td>
            <td class="numeric">${p.priority !== undefined ? p.priority : p.Priority}</td>
            <td class="numeric">${p.start !== undefined ? p.start : (p.Start_Time !== undefined ? p.Start_Time : 'N/A')}</td>
            <td class="numeric">${p.completion !== undefined ? p.completion : (p.Completion_Time !== undefined ? p.Completion_Time : 'N/A')}</td>
            <td class="numeric">${p.waiting !== undefined ? p.waiting : (p.Waiting_Time !== undefined ? p.Waiting_Time : 'N/A')}</td>
            <td class="numeric">${p.turnaround !== undefined ? p.turnaround : (p.Turnaround_Time !== undefined ? p.Turnaround_Time : 'N/A')}</td>
            <td class="numeric">${p.response !== undefined ? p.response : (p.Response_Time !== undefined ? p.Response_Time : 'N/A')}</td>
            <td>${starveBadge}</td>
          </tr>
        `;
      }).join('');

      // Bind row click handlers
      tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
          const pid = tr.getAttribute('data-pid');
          if (pid) {
            this.selectProcess(pid);
          }
        });
      });
    },

    selectProcess: function (pid) {
      this.selectedPid = pid;

      const tbody = document.getElementById('analysis-table-body');
      if (tbody) {
        tbody.querySelectorAll('tr').forEach(tr => {
          if (tr.getAttribute('data-pid') === pid) {
            tr.classList.add('is-selected');
          } else {
            tr.classList.remove('is-selected');
          }
        });
      }

      this.renderDetailCard(pid);
    },

    renderDetailCard: function (pid, procsList) {
      const container = document.getElementById('analysis-process-detail-card');
      if (!container) return;

      const list = procsList || this.getProcesses();
      const p = list.find(item => (item.pid === pid || item.PID === pid));

      if (!p) {
        container.innerHTML = `
          <div class="detail-empty-state">
            <div class="detail-empty-icon">🔍</div>
            <div class="detail-empty-title">No Process Selected</div>
            <div class="detail-empty-desc">Click any row in the table to inspect individual execution intervals and lifecycle metrics.</div>
          </div>
        `;
        return;
      }

      const procId = p.pid || p.PID;
      const color = PROCESS_COLORS[procId] || DEFAULT_PROCESS_COLOR;
      const slices = this.getSlices(procId);
      const totalSliceDuration = slices.reduce((acc, s) => acc + s.duration, 0);

      // Starvation Threshold
      let starveThresh;
      if (this.isLive && this.liveMetrics) {
        starveThresh = this.liveMetrics.Starvation_Threshold;
      } else {
        const sumWait = list.reduce((acc, item) => acc + (item.waiting || 0), 0);
        const avgWait = list.length > 0 ? (sumWait / list.length) : 0;
        starveThresh = (2.0 * avgWait).toFixed(2);
      }

      const isStarved = (p.starved === true || p.Starved === true);
      const waitTime = p.waiting !== undefined ? p.waiting : p.Waiting_Time;
      const burstTime = p.burst !== undefined ? p.burst : p.Burst_Time;
      const priorityVal = p.priority !== undefined ? p.priority : p.Priority;
      const arrivalVal = p.arrival !== undefined ? p.arrival : p.Arrival_Time;
      const startTime = p.start !== undefined ? p.start : p.Start_Time;
      const compTime = p.completion !== undefined ? p.completion : p.Completion_Time;
      const turnTime = p.turnaround !== undefined ? p.turnaround : p.Turnaround_Time;
      const respTime = p.response !== undefined ? p.response : p.Response_Time;

      // Build execution intervals tree ladder
      let intervalsContent = '';
      if (slices.length === 0) {
        intervalsContent = `
          <div style="color:var(--text-muted); font-size:12px; padding:8px 0;">
            Single continuous run: ${startTime}–${compTime} ms (${burstTime} ms)
          </div>
        `;
      } else {
        intervalsContent = `
          <div class="slice-tree-list">
            <div style="font-weight:700; color:${color}; margin-bottom:6px;">${procId} Execution Trace (${slices.length} Slices):</div>
            ${slices.map((sl, idx) => {
              const isLast = idx === slices.length - 1;
              const branch = isLast ? '└──' : '├──';
              return `
                <div class="slice-tree-node">
                  <span class="slice-tree-branch">${branch}</span>
                  <span class="slice-tree-range">${sl.start}–${sl.end} ms</span>
                  <span class="slice-tree-dur">(${sl.duration} ms)</span>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      container.innerHTML = `
        <div class="detail-header">
          <div class="detail-proc-id-group">
            <span class="detail-proc-badge" style="color:${color}; border-color:${color}; background:rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, 0.15);">
              ${procId}
            </span>
            <div>
              <div class="detail-proc-meta-title">Process Deep Dive</div>
              <div class="detail-proc-meta-sub">Priority ${priorityVal} • Arrival at ${arrivalVal} ms</div>
            </div>
          </div>
          <div>
            ${isStarved 
              ? `<span class="badge-starved">● STARVED</span>` 
              : `<span class="badge-not-starved">✓ NOT STARVED</span>`
            }
          </div>
        </div>

        <div class="detail-metrics-grid">
          <div class="detail-metric-box">
            <div class="detail-metric-label">Burst Time</div>
            <div class="detail-metric-value">${burstTime}<span class="detail-metric-unit"> ms</span></div>
          </div>
          <div class="detail-metric-box">
            <div class="detail-metric-label">Priority</div>
            <div class="detail-metric-value">${priorityVal}</div>
          </div>
          <div class="detail-metric-box">
            <div class="detail-metric-label">Start Time</div>
            <div class="detail-metric-value">${startTime}<span class="detail-metric-unit"> ms</span></div>
          </div>
          <div class="detail-metric-box">
            <div class="detail-metric-label">Completion</div>
            <div class="detail-metric-value">${compTime}<span class="detail-metric-unit"> ms</span></div>
          </div>
          <div class="detail-metric-box" style="border-left:2px solid var(--accent-cyan);">
            <div class="detail-metric-label">Waiting Time</div>
            <div class="detail-metric-value" style="color:var(--accent-cyan);">${waitTime}<span class="detail-metric-unit"> ms</span></div>
          </div>
          <div class="detail-metric-box">
            <div class="detail-metric-label">Turnaround</div>
            <div class="detail-metric-value">${turnTime}<span class="detail-metric-unit"> ms</span></div>
          </div>
          <div class="detail-metric-box">
            <div class="detail-metric-label">Response Time</div>
            <div class="detail-metric-value">${respTime}<span class="detail-metric-unit"> ms</span></div>
          </div>
          <div class="detail-metric-box">
            <div class="detail-metric-label">Execution Slices</div>
            <div class="detail-metric-value">${slices.length > 0 ? slices.length : 1}</div>
          </div>
        </div>

        <div class="detail-starve-banner ${isStarved ? 'is-starved' : ''}">
          <div class="detail-starve-title">
            <span>Starvation Evaluation (metrics.py)</span>
            <span style="font-weight:700;">${isStarved ? 'STARVED' : 'PASS'}</span>
          </div>
          <div class="detail-starve-formula">
            W_i (${waitTime} ms) ${isStarved ? '>' : '≤'} 2 × W_avg (${starveThresh} ms)
          </div>
        </div>

        <div class="slices-tree-container">
          <div class="slices-tree-header">
            <span>Execution Intervals (${slices.length > 0 ? slices.length : 1} slices)</span>
            <span style="font-family:var(--font-mono); color:var(--accent-cyan);">Total: ${totalSliceDuration || burstTime} ms</span>
          </div>
          ${intervalsContent}
        </div>
      `;
    },

    exportCSV: function () {
      const list = this.getProcesses();
      const sorted = this.sortProcesses(list);

      if (sorted.length === 0) {
        alert('No process data available to export.');
        return;
      }

      const headers = [
        'PID',
        'Arrival Time',
        'Burst Time',
        'Priority',
        'Start Time',
        'Completion Time',
        'Waiting Time',
        'Turnaround Time',
        'Response Time',
        'Starved'
      ];

      const csvRows = [headers.join(',')];

      sorted.forEach(p => {
        const isStarved = (p.starved === true || p.Starved === true);
        const row = [
          p.pid || p.PID,
          p.arrival !== undefined ? p.arrival : p.Arrival_Time,
          p.burst !== undefined ? p.burst : p.Burst_Time,
          p.priority !== undefined ? p.priority : p.Priority,
          p.start !== undefined ? p.start : p.Start_Time,
          p.completion !== undefined ? p.completion : p.Completion_Time,
          p.waiting !== undefined ? p.waiting : p.Waiting_Time,
          p.turnaround !== undefined ? p.turnaround : p.Turnaround_Time,
          p.response !== undefined ? p.response : p.Response_Time,
          isStarved ? 'STARVED' : 'NOT STARVED'
        ];
        csvRows.push(row.join(','));
      });

      const csvString = csvRows.join('\n');
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const algoSlug = String(this.activeAlgorithm).toLowerCase().replace(/\s+/g, '_');
      const filename = `process_analysis_${algoSlug}_${this.activeWorkload}_seed${this.activeSeed}.csv`;

      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      console.log(`[AnalysisController] Exported CSV: ${filename} (${sorted.length} records) from ${this.sourceDesc}`);

      // Temporary button state change to indicate success
      const btnExport = document.getElementById('btn-export-analysis-csv');
      if (btnExport) {
        const origHtml = btnExport.innerHTML;
        btnExport.innerHTML = `✓ Exported (${sorted.length} rows)`;
        btnExport.style.background = 'var(--accent-green)';
        btnExport.style.borderColor = 'var(--accent-green)';
        btnExport.style.color = '#050a14';
        setTimeout(() => {
          btnExport.innerHTML = origHtml;
          btnExport.style.background = '';
          btnExport.style.borderColor = '';
          btnExport.style.color = '';
        }, 2200);
      }
    }
  };

})(window);
