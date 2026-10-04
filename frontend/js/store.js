/** Minimal observable state shared by the four Phase 2 views. */
(function (window) {
  'use strict';

  const listeners = new Set();
  let state = {
    status: 'idle',
    route: 'overview',
    workload: 'normal',
    seed: 0,
    quantum: 2,
    algorithms: ['FCFS', 'FCFS+HNWF', 'SJF', 'SJF+HNWF', 'SRTF', 'SRTF+HNWF', 'RR', 'RR+HNWF', 'Priority', 'Priority+HNWF'],
    selectedAlgorithm: 'SRTF+HNWF',
    response: null,
    error: null
  };

  function emit() {
    listeners.forEach((listener) => listener(state));
    if (typeof window.CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new window.CustomEvent('scheduler:state', { detail: state }));
    }
  }

  function setState(patch) {
    state = { ...state, ...patch };
    emit();
    return state;
  }

  window.SchedulerStore = {
    getState: () => state,
    setState,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async run(overrides = {}) {
      const request = { ...state, ...overrides };
      setState({ status: 'loading', error: null, ...overrides });
      try {
        const response = await window.SchedulerAPI.simulate({
          workload: request.workload,
          seed: request.seed,
          algorithms: request.algorithms,
          quantum: request.quantum,
          hnwf: request.hnwf,
          custom_processes: request.custom_processes
        });
        return setState({ status: 'ready', response, error: null });
      } catch (error) {
        setState({ status: 'error', error: { message: error.message, code: error.code, field: error.field } });
        throw error;
      }
    }
  };
})(window);
