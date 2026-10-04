/**
 * scheduler-visualizer.js
 * Frontend controller & state bridge for the CPU Scheduling Visualization
 * 
 * Provides:
 * 1. window.CPU_STATUS_HOOKS: Dynamic reactive interface for updating HTML metrics
 * 2. Standalone demo timeline loop mirroring 3D hardware dispatch
 * 3. Algorithm switching & playback controls
 */

(function () {
  'use strict';

  // DOM Elements
  const elAlgo = document.getElementById('stat-algorithm');
  const elQuantum = document.getElementById('stat-quantum');
  const elProcess = document.getElementById('stat-process');
  const elRemaining = document.getElementById('stat-remaining');
  const elCore = document.getElementById('stat-core');
  const elTime = document.getElementById('stat-time');
  const elState = document.getElementById('stat-state');
  const elPills = document.querySelectorAll('.algo-pill');

  // Active State
  let currentAlgorithm = 'RR';
  let isPaused = false;
  let simulationTime = 0.0;
  let timerInterval = null;

  // Algorithm presets for simulation demonstration
  const DEMO_STATES = {
    'RR': {
      algorithm: 'ROUND ROBIN',
      quantum: '2 ms',
      process: 'P5',
      remaining: '3 ms',
      core: 'Core 1',
      state: 'RUNNING',
      stateClass: 'badge-running'
    },
    'FCFS': {
      algorithm: 'FCFS',
      quantum: 'N/A (Arrival Order)',
      process: 'P1',
      remaining: '4 ms',
      core: 'Core 1',
      state: 'RUNNING',
      stateClass: 'badge-running'
    },
    'SJF': {
      algorithm: 'SJF',
      quantum: 'N/A (Shortest Burst)',
      process: 'P4',
      remaining: '2 ms',
      core: 'Core 4',
      state: 'RUNNING',
      stateClass: 'badge-running'
    },
    'SRTF': {
      algorithm: 'SRTF',
      quantum: 'Preemptive',
      process: 'P2',
      remaining: '2 ms',
      core: 'Core 2',
      state: 'RUNNING',
      stateClass: 'badge-running'
    },
    'PRIORITY': {
      algorithm: 'PRIORITY',
      quantum: 'Priority: 1 (Highest)',
      process: 'P2',
      remaining: '3 ms',
      core: 'Core 2',
      state: 'RUNNING',
      stateClass: 'badge-running'
    }
  };

  /**
   * JAVASCRIPT HOOKS API
   * External systems (Spline runtime, Streamlit backend, or websocket client)
   * can invoke these methods dynamically to update the HTML panel.
   */
  window.CPU_STATUS_HOOKS = {
    /**
     * Updates one or more values on the simulation status card.
     * @param {Object} data - Key-value map of status properties
     */
    updateStatus: function (data) {
      if (!data) return;

      if (data.algorithm && elAlgo) {
        elAlgo.textContent = data.algorithm;
      }
      if (data.quantum && elQuantum) {
        elQuantum.textContent = data.quantum;
      }
      if (data.process && elProcess) {
        elProcess.textContent = data.process;
      }
      if (data.remaining && elRemaining) {
        elRemaining.textContent = data.remaining;
      }
      if (data.core && elCore) {
        elCore.textContent = data.core;
      }
      if (data.time && elTime) {
        elTime.textContent = data.time;
      }
      if (data.state && elState) {
        elState.textContent = data.state;
        elState.className = 'state-badge ' + (data.stateClass || 'badge-running');
      }
    },

    /**
     * Switch algorithm programmatically.
     * @param {string} algoKey - 'RR' | 'FCFS' | 'SJF' | 'SRTF' | 'PRIORITY'
     */
    setAlgorithm: function (algoKey) {
      const key = String(algoKey).toUpperCase().trim();
      const matched = DEMO_STATES[key] ? key : 'RR';
      currentAlgorithm = matched;

      // Update UI pills
      elPills.forEach(pill => {
        if (pill.getAttribute('data-algo') === matched) {
          pill.classList.add('active');
        } else {
          pill.classList.remove('active');
        }
      });

      // Apply initial state
      window.CPU_STATUS_HOOKS.updateStatus(DEMO_STATES[matched]);

      // If connected to Spline iframe or window.CPU_SCHEDULER, notify it
      try {
        if (window.CPU_SCHEDULER && typeof window.CPU_SCHEDULER.setAlgorithm === 'function') {
          window.CPU_SCHEDULER.setAlgorithm(matched);
        }
        // Also message embedded iframe if present
        const iframe = document.getElementById('spline-frame');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'SET_ALGORITHM', algorithm: matched }, '*');
        }
      } catch (err) {
        console.log('[Visualizer] Local bridge dispatch:', err);
      }
    },

    /**
     * Toggles playback pause/resume.
     */
    togglePause: function () {
      isPaused = !isPaused;
      const pauseBtn = document.getElementById('btn-toggle-pause');
      if (pauseBtn) {
        pauseBtn.innerHTML = isPaused ? '<span>▶</span> Resume' : '<span>⏸</span> Pause';
      }
      if (window.CPU_SCHEDULER && typeof window.CPU_SCHEDULER.togglePause === 'function') {
        window.CPU_SCHEDULER.togglePause();
      }
    },

    /**
     * Resets visualizer simulation.
     */
    reset: function () {
      simulationTime = 0.0;
      if (elTime) elTime.textContent = '0.0 s';
      window.CPU_STATUS_HOOKS.setAlgorithm(currentAlgorithm);
      if (window.CPU_SCHEDULER && typeof window.CPU_SCHEDULER.reset === 'function') {
        window.CPU_SCHEDULER.reset();
      }
    },

    /**
     * Get current status state snapshot.
     */
    getStatus: function () {
      return {
        algorithm: currentAlgorithm,
        isPaused: isPaused,
        simulationTime: simulationTime
      };
    }
  };

  // Wire Algorithm Switcher Pills
  elPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const algo = pill.getAttribute('data-algo');
      window.CPU_STATUS_HOOKS.setAlgorithm(algo);
    });
  });

  // Topbar Controls
  const btnPause = document.getElementById('btn-toggle-pause');
  if (btnPause) {
    btnPause.addEventListener('click', () => window.CPU_STATUS_HOOKS.togglePause());
  }

  const btnReset = document.getElementById('btn-reset-sim');
  if (btnReset) {
    btnReset.addEventListener('click', () => window.CPU_STATUS_HOOKS.reset());
  }

  // Simulation Clock Tick (runs when standalone)
  timerInterval = setInterval(() => {
    if (!isPaused) {
      simulationTime += 0.2;
      if (elTime) {
        elTime.textContent = simulationTime.toFixed(1) + ' s';
      }
    }
  }, 200);

  // Initialize with Round Robin default
  window.CPU_STATUS_HOOKS.setAlgorithm('RR');
  console.log('[CPU Visualizer] Frontend controller and hooks initialized.');
})();
