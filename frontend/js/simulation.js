/**
 * simulation.js — 3D Spline Visualization & Coherent Simulation Controller
 * CPU Scheduling Analyzer (Phase 1 Baseline)
 * 
 * Connected to live FastAPI backend (POST /api/simulate) for authoritative Python scheduling.
 * Clean academic simulator model: single CPU execution, authentic schedule timeline, zero fake timers.
 */

(function (window) {
  'use strict';

  // Active Simulation State
  let activeAlgorithm = 'RR';
  let roundRobinQuantum = 2;
  let lastSimulationResult = null;

  // Configuration metadata for supported scheduling algorithms
  const ALGORITHM_CONFIGS = {
    'RR': {
      title: 'ROUND ROBIN',
      defaultQuantum: 2,
      quantumDisplay: '2 ms',
      showQuantumControl: true,
      description: 'Preemptive time-sliced CPU dispatch with round-robin queue rotation'
    },
    'FCFS': {
      title: 'FIRST-COME, FIRST-SERVED (FCFS)',
      defaultQuantum: null,
      quantumDisplay: 'N/A (Arrival Order)',
      showQuantumControl: false,
      description: 'Non-preemptive scheduling in strict arrival timestamp order'
    },
    'SJF': {
      title: 'SHORTEST JOB FIRST (SJF)',
      defaultQuantum: null,
      quantumDisplay: 'N/A (Shortest Job)',
      showQuantumControl: false,
      description: 'Non-preemptive selection of arrived process with shortest CPU burst'
    },
    'SRTF': {
      title: 'SHORTEST REMAINING TIME FIRST (SRTF)',
      defaultQuantum: null,
      quantumDisplay: 'N/A (Preemptive Burst)',
      showQuantumControl: false,
      description: 'Preemptive selection of process with least remaining CPU execution time'
    },
    'PRIORITY': {
      title: 'PRIORITY SCHEDULING',
      defaultQuantum: null,
      quantumDisplay: 'N/A (Priority Rank)',
      showQuantumControl: false,
      description: 'Non-preemptive dispatch based on priority class (lower number = higher priority)'
    }
  };

  /**
   * JAVASCRIPT HOOKS API
   * Used by controllers, Spline scene, or Python API to update the HTML panel dynamically.
   */
  window.CPU_STATUS_HOOKS = {
    hasResult: function () {
      return lastSimulationResult !== null;
    },

    updateStatus: function (data) {
      if (!data) return;

      const elAlgo = document.getElementById('stat-algo-name');
      const elState = document.getElementById('stat-proc-state');
      const elProcess = document.getElementById('stat-proc-id');
      const elCore = document.getElementById('stat-cpu-core');
      const elQuantum = document.getElementById('stat-quantum-val');
      const elRemaining = document.getElementById('stat-remaining-val');
      const elTime = document.getElementById('stat-sim-time');

      if (data.algorithm && elAlgo) elAlgo.textContent = data.algorithm;
      if (data.process && elProcess) elProcess.textContent = data.process;
      if (data.core && elCore) elCore.textContent = data.core;
      if (data.quantum && elQuantum) elQuantum.textContent = data.quantum;
      if (data.remaining && elRemaining) elRemaining.textContent = data.remaining;
      if (data.time && elTime) elTime.textContent = data.time;
      if (data.state && elState) {
        elState.textContent = data.state;
        elState.className = 'state-badge ' + (data.stateClass || 'badge-running');
      }
    },

    setAlgorithm: function (algoKey) {
      const key = String(algoKey).toUpperCase().trim();
      const cfg = ALGORITHM_CONFIGS[key] || ALGORITHM_CONFIGS['RR'];
      activeAlgorithm = key;
      lastSimulationResult = null; // Clear previous algorithm's result

      // Update button selection
      document.querySelectorAll('.sim-algo-btn').forEach(btn => {
        if (btn.getAttribute('data-algo') === key) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      // Toggle Quantum input visibility
      const qBox = document.getElementById('quantum-control-container');
      if (qBox) {
        if (cfg.showQuantumControl) {
          qBox.classList.remove('hidden');
          const input = document.getElementById('input-time-quantum');
          if (input) input.disabled = false;
        } else {
          qBox.classList.add('hidden');
          const input = document.getElementById('input-time-quantum');
          if (input) input.disabled = true;
        }
      }

      // Read current workload info
      let procCount = 6;
      let totalBurst = 0;
      let firstProcId = 'P1';
      let firstProcBurst = '0 ms';
      if (window.WorkloadManager) {
        const procs = window.WorkloadManager.getActiveProcesses();
        if (procs && procs.length > 0) {
          procCount = procs.length;
          firstProcId = procs[0].pid || 'P1';
          firstProcBurst = (procs[0].burst || 0) + ' ms';
          totalBurst = procs.reduce((acc, p) => acc + (Number(p.burst) || 0), 0);
        }
      }

      // Update status panel to coherent READY state
      this.updateStatus({
        algorithm: cfg.title,
        state: 'READY',
        stateClass: 'badge-paused',
        process: firstProcId,
        core: 'Core 1 (Single CPU)',
        quantum: cfg.showQuantumControl ? (roundRobinQuantum + ' ms') : cfg.quantumDisplay,
        remaining: firstProcBurst,
        time: 'Ready to run'
      });

      // Re-render unexecuted 8-column table and ready stats
      if (window.WorkloadManager) {
        window.WorkloadManager.renderPreviewTable('preview-table-body', 'dataset-stats-container');
      }

      console.log('[Simulation] Selected algorithm:', key);
    },

    setQuantum: function (val) {
      const q = Math.max(1, parseInt(val, 10) || 2);
      roundRobinQuantum = q;
      ALGORITHM_CONFIGS['RR'].defaultQuantum = q;
      ALGORITHM_CONFIGS['RR'].quantumDisplay = q + ' ms';
      if (activeAlgorithm === 'RR') {
        const elQuantum = document.getElementById('stat-quantum-val');
        if (elQuantum) elQuantum.textContent = q + ' ms';
      }
      console.log('[Simulation] Round Robin quantum set to:', q);
    },

    /**
     * Executes authoritative simulation via FastAPI backend (POST /api/simulate)
     */
    runSimulation: async function () {
      const btnRun = document.getElementById('btn-run-simulation');
      if (btnRun) {
        btnRun.classList.add('loading');
        btnRun.innerHTML = `<span>⟳</span> EXECUTING...`;
      }

      // Extract parameters from WorkloadManager
      let workload = 'normal';
      let seed = 0;
      let customProcs = null;

      if (window.WorkloadManager) {
        const wmState = window.WorkloadManager.getState();
        workload = wmState.workloadType;
        seed = wmState.seed;
        if (workload === 'custom' && wmState.customProcesses.length > 0) {
          customProcs = wmState.customProcesses;
        }
      }

      // Map algorithm key for backend
      let apiAlgo = activeAlgorithm;
      if (apiAlgo === 'PRIORITY') apiAlgo = 'Priority';

      const payload = {
        workload: workload,
        seed: seed,
        algorithms: [apiAlgo],
        quantum: roundRobinQuantum,
        custom_processes: customProcs
      };

      console.log('[Simulation] Requesting execution from Python backend:', payload);

      try {
        if (!window.SchedulerAPI || typeof window.SchedulerAPI.simulate !== 'function') {
          throw new Error('SchedulerAPI client not available.');
        }

        const res = await window.SchedulerAPI.simulate(payload);

        if (btnRun) {
          btnRun.classList.remove('loading');
          btnRun.innerHTML = `<span>▶</span> RUN SIMULATION`;
        }

        if (res && res.status === 'success' && res.results && res.results[apiAlgo]) {
          const algoResult = res.results[apiAlgo];
          const metrics = algoResult.metrics;
          const procs = algoResult.processes || [];
          const slices = algoResult.slices || [];

          // Compute makespan and total burst directly from returned execution schedule
          const maxCompletion = procs.reduce((max, p) => Math.max(max, Number(p.Completion_Time || p.completion || 0)), 0);
          const minArrival = procs.reduce((min, p) => Math.min(min, Number(p.Arrival_Time || p.arrival || 0)), Infinity);
          const makespan = maxCompletion > 0 ? (maxCompletion - (minArrival < Infinity ? minArrival : 0)) : 0;
          const totalBurst = procs.reduce((sum, p) => sum + Number(p.Burst_Time || p.burst || 0), 0);

          algoResult.makespan = makespan;
          algoResult.totalBurst = totalBurst;
          lastSimulationResult = algoResult;

          // 1. Update HTML Status Card with coherent completed schedule readings
          this.updateStatus({
            algorithm: ALGORITHM_CONFIGS[activeAlgorithm] ? ALGORITHM_CONFIGS[activeAlgorithm].title : activeAlgorithm,
            state: 'COMPLETED',
            stateClass: 'badge-running',
            process: `${procs.length} Scheduled`,
            core: 'Core 1 (Single CPU)',
            quantum: activeAlgorithm === 'RR' ? (roundRobinQuantum + ' ms') : 'N/A',
            remaining: '0 ms (Completed)',
            time: `0 → ${maxCompletion} ms (${makespan} ms total)`
          });

          // 2. Update Dataset Stats Strip with authentic Python metrics (clean academic presentation)
          const statsContainer = document.getElementById('dataset-stats-container');
          if (statsContainer) {
            const isStarved = metrics.Starvation_Count > 0;
            statsContainer.innerHTML = `
              <div class="stat-chip">Avg Wait: <strong>${metrics.Avg_Waiting_Time.toFixed(1)} ms</strong></div>
              <div class="stat-chip">Avg Turnaround: <strong>${metrics.Avg_Turnaround_Time.toFixed(1)} ms</strong></div>
              <div class="stat-chip">Avg Response: <strong>${metrics.Avg_Response_Time.toFixed(1)} ms</strong></div>
              <div class="stat-chip">Jain's Fairness: <strong>${metrics.Jains_Fairness_Index.toFixed(3)}</strong></div>
              <div class="stat-chip">Starved Count: <strong style="color:${isStarved ? '#fb7185' : '#4ade80'}">${metrics.Starvation_Count}</strong></div>
              <div class="stat-chip">Starvation Threshold: <strong>${(metrics.Starvation_Threshold !== undefined ? metrics.Starvation_Threshold : (2 * (metrics.Avg_Waiting_Time || 0))).toFixed(1)} ms</strong></div>
            `;
          }

          // 3. Update Dataset Preview Table with authentic completed schedule times
          const previewTable = document.getElementById('preview-table-body');
          if (previewTable && procs.length > 0) {
            previewTable.innerHTML = procs.map(p => {
              const pid = p.PID || p.pid;
              const arrival = p.Arrival_Time !== undefined ? p.Arrival_Time : p.arrival;
              const burst = p.Burst_Time !== undefined ? p.Burst_Time : p.burst;
              const priority = p.Priority !== undefined ? p.Priority : p.priority;
              const start = p.Start_Time !== undefined ? p.Start_Time : p.start;
              const comp = p.Completion_Time !== undefined ? p.Completion_Time : p.completion;
              const wait = p.Waiting_Time !== undefined ? p.Waiting_Time : p.waiting;
              const isStarved = Boolean(p.Starved || p.starved);

              const stateBadge = isStarved
                ? `<span class="badge-starved">● STARVED (Wait: ${wait}ms)</span>`
                : `<span class="badge-not-starved">✓ Completed (Wait: ${wait}ms)</span>`;

              return `
                <tr>
                  <td><strong style="color:var(--accent-cyan)">${pid}</strong></td>
                  <td>${arrival} ms</td>
                  <td>${burst} ms</td>
                  <td>${priority}</td>
                  <td>${start} ms</td>
                  <td>${comp} ms</td>
                  <td>${wait} ms</td>
                  <td>${stateBadge}</td>
                </tr>
              `;
            }).join('');
          }

          console.log('[Simulation] Displaying completed execution schedule for', apiAlgo, metrics);
        } else {
          throw new Error((res && res.error) || 'Backend simulation did not return results for ' + apiAlgo);
        }
      } catch (err) {
        if (btnRun) {
          btnRun.classList.remove('loading');
          btnRun.innerHTML = `<span>▶</span> RUN SIMULATION`;
        }

        console.error('[Simulation] Execution failed:', err.message);

        // Show clear "Backend Offline" state
        this.updateStatus({
          state: 'BACKEND OFFLINE',
          stateClass: 'badge-paused',
          time: 'Execution Unavailable'
        });

        const statsContainer = document.getElementById('dataset-stats-container');
        if (statsContainer) {
          statsContainer.innerHTML = `
            <div class="stat-chip" style="border-color:#f43f5e; color:#fb7185;">
              <strong>⚠ Backend Offline</strong>: FastAPI server unreachable at http://127.0.0.1:8000/api
            </div>
          `;
        }
      }
    },

    reset: function () {
      lastSimulationResult = null;
      const elTime = document.getElementById('stat-sim-time');
      if (elTime) elTime.textContent = 'Ready to run';

      this.setAlgorithm(activeAlgorithm);

      if (window.WorkloadManager) {
        window.WorkloadManager.renderAllPreviews();
      }

      const statsContainer = document.getElementById('dataset-stats-container');
      if (statsContainer) {
        statsContainer.innerHTML = `<div class="stat-chip">Schedule reset. Click <strong>RUN SIMULATION</strong> to execute.</div>`;
      }

      console.log('[Simulation] Simulation view reset.');
    }
  };

  /**
   * Controller lifecycle mounted when Simulation page view opens
   */
  window.SimulationController = {
    mount: function () {
      console.log('[SimulationController] Mounting Simulation view...');

      // Mount WorkloadManager controls in the simulation view
      if (window.WorkloadManager) {
        window.WorkloadManager.mount();
        window.WorkloadManager.onWorkloadChange((procs) => {
          lastSimulationResult = null;
          if (procs && procs.length > 0) {
            const first = procs[0];
            const elProc = document.getElementById('stat-proc-id');
            const elRemaining = document.getElementById('stat-remaining-val');
            const elTime = document.getElementById('stat-sim-time');
            if (elProc) elProc.textContent = first.pid;
            if (elRemaining) elRemaining.textContent = first.burst + ' ms';
            if (elTime) elTime.textContent = 'Ready to run';
          }
          if (window.WorkloadManager) {
            window.WorkloadManager.renderPreviewTable('preview-table-body', 'dataset-stats-container');
          }
        });
      }

      // Bind algorithm selection buttons
      document.querySelectorAll('.sim-algo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const algo = btn.getAttribute('data-algo');
          window.CPU_STATUS_HOOKS.setAlgorithm(algo);
        });
      });

      // Bind Quantum input
      const qInput = document.getElementById('input-time-quantum');
      if (qInput) {
        qInput.value = roundRobinQuantum;
        qInput.addEventListener('change', (e) => {
          window.CPU_STATUS_HOOKS.setQuantum(e.target.value);
        });
      }

      // Bind Master Simulation Action Buttons
      const btnRunSim = document.getElementById('btn-run-simulation');
      if (btnRunSim) {
        btnRunSim.addEventListener('click', () => {
          window.CPU_STATUS_HOOKS.runSimulation();
        });
      }

      const btnResetSim = document.getElementById('btn-reset-simulation');
      if (btnResetSim) {
        btnResetSim.addEventListener('click', () => {
          window.CPU_STATUS_HOOKS.reset();
        });
      }

      // Initialize with active algorithm
      window.CPU_STATUS_HOOKS.setAlgorithm(activeAlgorithm);
    },

    runSimulation: function () {
      return window.CPU_STATUS_HOOKS.runSimulation();
    },

    reset: function () {
      return window.CPU_STATUS_HOOKS.reset();
    },

    hasResult: function () {
      return window.CPU_STATUS_HOOKS.hasResult();
    }
  };

})(window);
