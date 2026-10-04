/**
 * workloads.js — Workload Configuration, Custom CSV Parser & Dataset Preview Controller
 * CPU Scheduling Analyzer (Phase 1 Baseline)
 * 
 * Connects to live FastAPI backend (GET /api/workload) to retrieve Python-generated datasets.
 */

(function (window) {
  'use strict';

  // Workload State
  const state = {
    workloadType: 'normal',   // 'normal' | 'skewed' | 'bursty' | 'custom'
    processCount: 6,
    seed: 0,
    customProcesses: [],
    customFileName: '',
    liveProcesses: null,
    liveSource: '',
    onWorkloadChangeCallbacks: []
  };

  // Fallback data in case backend is offline and window.WORKLOAD_DATA is unavailable
  const FALLBACK_SEEDS = {
    normal: [
      { pid: 'P1', arrival: 0, burst: 17, priority: 7 },
      { pid: 'P2', arrival: 0, burst: 13, priority: 4 },
      { pid: 'P3', arrival: 1, burst: 5, priority: 5 },
      { pid: 'P4', arrival: 3, burst: 16, priority: 9 },
      { pid: 'P5', arrival: 7, burst: 15, priority: 8 },
      { pid: 'P6', arrival: 10, burst: 17, priority: 9 }
    ],
    skewed: [
      { pid: 'P1', arrival: 0, burst: 2, priority: 3 },
      { pid: 'P2', arrival: 0, burst: 2, priority: 5 },
      { pid: 'P3', arrival: 1, burst: 47, priority: 7 },
      { pid: 'P4', arrival: 3, burst: 5, priority: 5 },
      { pid: 'P5', arrival: 7, burst: 76, priority: 7 },
      { pid: 'P6', arrival: 10, burst: 7, priority: 4 }
    ],
    bursty: [
      { pid: 'P1', arrival: 0, burst: 26, priority: 7 },
      { pid: 'P2', arrival: 0, burst: 18, priority: 4 },
      { pid: 'P3', arrival: 0, burst: 5, priority: 5 },
      { pid: 'P4', arrival: 0, burst: 24, priority: 9 },
      { pid: 'P5', arrival: 1, burst: 23, priority: 8 },
      { pid: 'P6', arrival: 1, burst: 26, priority: 9 }
    ]
  };

  window.WorkloadManager = {
    getState: function () {
      return { ...state };
    },

    onWorkloadChange: function (callback) {
      if (typeof callback === 'function') {
        state.onWorkloadChangeCallbacks.push(callback);
      }
    },

    notifyChange: function () {
      state.onWorkloadChangeCallbacks.forEach(fn => {
        try { fn(this.getActiveProcesses(), state); } catch (e) { console.error(e); }
      });
    },

    /**
     * Asynchronously requests workload dataset from Python FastAPI backend.
     */
    fetchBackendWorkload: async function () {
      if (state.workloadType === 'custom') return;

      if (window.SchedulerAPI && typeof window.SchedulerAPI.getWorkload === 'function') {
        try {
          const res = await window.SchedulerAPI.getWorkload(state.workloadType, state.seed, state.processCount);
          if (res && res.status === 'success' && Array.isArray(res.processes) && res.processes.length > 0) {
            state.liveProcesses = res.processes;
            state.liveSource = `Live Python Backend: ${state.workloadType}_seed${state.seed}.csv`;
            this.renderAllPreviews();
            this.notifyChange();
            console.log(`[Workloads] Received ${res.processes.length} processes from live Python backend.`);
            return;
          }
        } catch (err) {
          console.warn('[Workloads] Live backend fetch error, using local fallback:', err.message);
        }
      }

      // Backend unavailable or error
      state.liveProcesses = null;
      state.liveSource = `Local Cache (Backend Offline): ${state.workloadType}_seed${state.seed}.csv`;
      this.renderAllPreviews();
      this.notifyChange();
    },

    /**
     * Retrieves the active list of processes based on type, seed, and count limit.
     * Priority: 1) Custom CSV, 2) Live Python backend result, 3) Precompiled data, 4) Fallback.
     */
    getActiveProcesses: function () {
      if (state.workloadType === 'custom' && state.customProcesses.length > 0) {
        return state.customProcesses.slice(0, state.processCount);
      }

      if (state.liveProcesses && state.liveProcesses.length > 0) {
        return state.liveProcesses.slice(0, state.processCount);
      }

      if (window.WORKLOAD_DATA && 
          window.WORKLOAD_DATA[state.workloadType] && 
          window.WORKLOAD_DATA[state.workloadType][state.seed]) {
        const list = window.WORKLOAD_DATA[state.workloadType][state.seed];
        return list.slice(0, state.processCount);
      }

      // Fallback
      const fallback = FALLBACK_SEEDS[state.workloadType] || FALLBACK_SEEDS.normal;
      return fallback.slice(0, state.processCount);
    },

    /**
     * Calculates statistical summary of process bursts.
     */
    getStats: function (processes) {
      const procs = processes || this.getActiveProcesses();
      if (!procs || procs.length === 0) {
        return { count: 0, avgBurst: '0.0', minBurst: 0, maxBurst: 0 };
      }

      const bursts = procs.map(p => Number(p.burst) || 0);
      const sum = bursts.reduce((acc, b) => acc + b, 0);
      const avg = (sum / bursts.length).toFixed(1);
      const min = Math.min(...bursts);
      const max = Math.max(...bursts);

      return {
        count: procs.length,
        avgBurst: avg,
        minBurst: min,
        maxBurst: max
      };
    },

    setWorkloadType: function (type) {
      if (!['normal', 'skewed', 'bursty', 'custom'].includes(type)) return;
      state.workloadType = type;
      this.syncUI();
      this.fetchBackendWorkload();
      this.renderAllPreviews();
      this.notifyChange();
    },

    setProcessCount: function (count) {
      const n = Math.max(1, Math.min(25, parseInt(count, 10) || 6));
      state.processCount = n;
      this.syncUI();
      this.fetchBackendWorkload();
      this.renderAllPreviews();
      this.notifyChange();
    },

    setSeed: function (seed) {
      const s = Math.max(0, Math.min(9, parseInt(seed, 10) || 0));
      state.seed = s;
      if (state.workloadType === 'custom') {
        state.workloadType = 'normal';
      }
      this.syncUI();
      this.fetchBackendWorkload();
      this.renderAllPreviews();
      this.notifyChange();
    },

    /**
     * Parses uploaded custom CSV text.
     * Expected fields: PID, Arrival_Time, Burst_Time, Priority
     */
    parseCustomCSV: function (csvText, fileName) {
      if (!csvText || typeof csvText !== 'string') return;

      const lines = csvText.trim().split(/\r?\n/);
      if (lines.length < 2) {
        alert('Uploaded CSV file must contain a header and at least one process row.');
        return;
      }

      // Detect delimiter (, or ; or \t)
      const firstLine = lines[0];
      let delimiter = ',';
      if (firstLine.includes('\t')) delimiter = '\t';
      else if (firstLine.includes(';') && !firstLine.includes(',')) delimiter = ';';

      const headers = firstLine.split(delimiter).map(h => h.trim().toLowerCase());

      // Resolve column index mappings
      const pidIdx = headers.findIndex(h => h === 'pid' || h === 'process' || h === 'process_id' || h === 'id');
      const arrivalIdx = headers.findIndex(h => h.includes('arrival'));
      const burstIdx = headers.findIndex(h => h.includes('burst'));
      const priorityIdx = headers.findIndex(h => h.includes('priority'));

      if (pidIdx === -1 || arrivalIdx === -1 || burstIdx === -1 || priorityIdx === -1) {
        alert('Invalid CSV Format. The expected columns are: PID, Arrival_Time, Burst_Time, Priority');
        return;
      }

      const parsedRows = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(delimiter);
        if (cols.length <= Math.max(pidIdx, arrivalIdx, burstIdx, priorityIdx)) continue;

        const pid = cols[pidIdx].trim();
        const arrival = parseInt(cols[arrivalIdx].trim(), 10) || 0;
        const burst = Math.max(1, parseInt(cols[burstIdx].trim(), 10) || 1);
        const priority = Math.max(1, parseInt(cols[priorityIdx].trim(), 10) || 1);

        parsedRows.push({ pid, arrival, burst, priority });
      }

      if (parsedRows.length === 0) {
        alert('Could not parse any valid process records from CSV.');
        return;
      }

      state.customProcesses = parsedRows;
      state.customFileName = fileName || 'custom_workload.csv';
      state.workloadType = 'custom';
      state.liveProcesses = null;
      state.liveSource = `Custom CSV: ${state.customFileName}`;
      state.processCount = Math.min(parsedRows.length, Math.max(6, parsedRows.length));

      this.syncUI();
      this.renderAllPreviews();
      this.notifyChange();

      console.log('[Workloads] Custom CSV loaded successfully:', state.customFileName, parsedRows.length, 'processes.');
    },

    /**
     * Renders dataset preview table and stats.
     */
    renderPreviewTable: function (tableBodyId = 'preview-table-body', statsContainerId = 'dataset-stats-container') {
      const tbody = document.getElementById(tableBodyId);
      const statsBox = document.getElementById(statsContainerId);

      const procs = this.getActiveProcesses();
      const stats = this.getStats(procs);
      const isSim = (tableBodyId === 'preview-table-body' || statsContainerId === 'dataset-stats-container');
      const hasSimResult = window.SimulationController && typeof window.SimulationController.hasResult === 'function' && window.SimulationController.hasResult();

      // Render Stats Bar only if not actively displaying completed simulation results
      if (statsBox) {
        if (!isSim || !hasSimResult) {
          let sourceLabel = '';
          if (state.workloadType === 'custom') {
            sourceLabel = `Custom: ${state.customFileName || 'Uploaded CSV'}`;
          } else if (state.liveSource) {
            sourceLabel = state.liveSource;
          } else {
            sourceLabel = `${state.workloadType}_seed${state.seed}.csv`;
          }

          const isLive = sourceLabel.includes('Live Python Backend');

          if (isSim) {
            statsBox.innerHTML = `
              <div class="stat-chip">Process Count: <strong>${stats.count}</strong></div>
              <div class="stat-chip">Average Burst: <strong>${stats.avgBurst} ms</strong></div>
              <div class="stat-chip">Min Burst: <strong>${stats.minBurst} ms</strong></div>
              <div class="stat-chip">Max Burst: <strong>${stats.maxBurst} ms</strong></div>
              <div class="stat-chip">Status: <strong>Ready to run</strong></div>
            `;
          } else {
            statsBox.innerHTML = `
              <div class="stat-chip">Process Count: <strong>${stats.count}</strong></div>
              <div class="stat-chip">Average Burst: <strong>${stats.avgBurst} ms</strong></div>
              <div class="stat-chip">Min Burst: <strong>${stats.minBurst} ms</strong></div>
              <div class="stat-chip">Max Burst: <strong>${stats.maxBurst} ms</strong></div>
              <div class="stat-chip">Source: <strong style="color:${isLive ? 'var(--accent-green)' : 'var(--accent-blue)'}">${sourceLabel}</strong></div>
            `;
          }
        }
      }

      // Render Table Rows
      if (tbody) {
        // If simulation has completed results displayed, do not overwrite with unexecuted rows
        if (isSim && hasSimResult) {
          return;
        }

        const is8Col = (tableBodyId === 'preview-table-body');
        if (procs.length === 0) {
          tbody.innerHTML = `<tr><td colspan="${is8Col ? 8 : 5}" style="text-align:center; color:var(--text-muted); padding:20px;">No processes found for selected workload.</td></tr>`;
          return;
        }

        if (is8Col) {
          tbody.innerHTML = procs.map((p, idx) => `
            <tr>
              <td><strong style="color:var(--accent-cyan)">${p.pid || 'P' + (idx + 1)}</strong></td>
              <td>${p.arrival} ms</td>
              <td>${p.burst} ms</td>
              <td>${p.priority}</td>
              <td>--</td>
              <td>--</td>
              <td>--</td>
              <td><span class="badge badge-neutral">Ready</span></td>
            </tr>
          `).join('');
        } else {
          tbody.innerHTML = procs.map((p, idx) => `
            <tr>
              <td><strong style="color:var(--accent-cyan)">${p.pid || 'P' + (idx + 1)}</strong></td>
              <td>${p.arrival} ms</td>
              <td>${p.burst} ms</td>
              <td>${p.priority}</td>
              <td><span class="badge badge-neutral">Ready</span></td>
            </tr>
          `).join('');
        }
      }
    },

    renderAllPreviews: function () {
      this.renderPreviewTable('preview-table-body', 'dataset-stats-container');
      this.renderPreviewTable('workloads-page-table-body', 'workloads-page-stats-container');
    },

    /**
     * Syncs control values across all DOM elements matching active state.
     */
    syncUI: function () {
      // Sync workload pills
      document.querySelectorAll('.workload-pill').forEach(btn => {
        const kind = btn.getAttribute('data-workload');
        if (kind === state.workloadType) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      // Sync process count inputs
      document.querySelectorAll('.input-proc-count').forEach(input => {
        input.value = state.processCount;
      });

      // Sync seed selects
      document.querySelectorAll('.select-workload-seed').forEach(select => {
        select.value = state.seed;
        // Disable seed selector if custom CSV is active
        select.disabled = (state.workloadType === 'custom');
      });

      // Sync custom badge
      const badge = document.getElementById('custom-csv-status-badge');
      if (badge) {
        if (state.workloadType === 'custom' && state.customFileName) {
          badge.innerHTML = `<span class="custom-file-badge">📄 ${state.customFileName}</span>`;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
    },

    mount: function () {
      // Bind workload pills
      document.querySelectorAll('.workload-pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const kind = btn.getAttribute('data-workload');
          if (kind) this.setWorkloadType(kind);
        });
      });

      // Bind process count input
      document.querySelectorAll('.input-proc-count').forEach(input => {
        input.addEventListener('change', (e) => {
          this.setProcessCount(e.target.value);
        });
      });

      // Bind seed select
      document.querySelectorAll('.select-workload-seed').forEach(select => {
        select.addEventListener('change', (e) => {
          this.setSeed(e.target.value);
        });
      });

      // Bind custom CSV file upload triggers
      document.querySelectorAll('.btn-upload-csv-trigger').forEach(btn => {
        btn.addEventListener('click', () => {
          const fileInput = document.getElementById('input-custom-csv-file');
          if (fileInput) fileInput.click();
        });
      });

      // Bind hidden file input
      const fileInput = document.getElementById('input-custom-csv-file');
      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = (event) => {
            this.parseCustomCSV(event.target.result, file.name);
          };
          reader.readAsText(file);
          e.target.value = '';
        });
      }

      this.syncUI();
      this.fetchBackendWorkload();
    }
  };

  // Auto-mount when WorkloadsController is requested
  window.WorkloadsController = {
    mount: function () {
      console.log('[WorkloadsController] Mounting view...');
      window.WorkloadManager.mount();
    }
  };

})(window);
