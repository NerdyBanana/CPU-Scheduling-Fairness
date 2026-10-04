/** API client for the Phase 2 scheduling and fairness engine. */
(function (window) {
  'use strict';

  const hostname = window.location && window.location.hostname ? window.location.hostname : '127.0.0.1';
  const API_BASE_URL = window.API_BASE_URL || `http://${hostname}:8000/api`;
  const BASE_ALGORITHMS = ['FCFS', 'SJF', 'SRTF', 'RR', 'Priority'];
  const DEFAULT_ALGORITHMS = BASE_ALGORITHMS.flatMap((name) => [name, `${name}+HNWF`]);
  const DEFAULT_HNWF = Object.freeze({
    gmax: 32,
    protected_quantum: 1,
    boost_interval: 8,
    max_boost: 4,
    debt_epsilon: 0.25,
    context_switch_cost: 0
  });

  async function decode(response) {
    let body;
    try {
      body = await response.json();
    } catch (_) {
      body = null;
    }
    if (response.ok) return body;
    const detail = body && body.detail ? body.detail : {};
    const error = new Error(detail.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.code = detail.code || 'HTTP_ERROR';
    error.field = detail.field || null;
    error.payload = body;
    throw error;
  }

  async function request(path, options) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Accept: 'application/json', ...(options && options.headers) },
      ...options
    });
    return decode(response);
  }

  window.SchedulerAPI = {
    baseUrl: API_BASE_URL,
    algorithms: DEFAULT_ALGORITHMS.slice(),
    defaultHnwf: { ...DEFAULT_HNWF },

    async checkHealth() {
      try {
        return await request('/health', { method: 'GET' });
      } catch (error) {
        return { status: 'unavailable', error: error.message, code: error.code || 'NETWORK_ERROR' };
      }
    },

    async getWorkload(type = 'normal', seed = 0, n = 25) {
      const query = new URLSearchParams({ type, seed: String(seed), n: String(n) });
      return request(`/workload?${query.toString()}`, { method: 'GET' });
    },

    async simulate(input = {}) {
      const payload = {
        workload: input.workload || 'normal',
        seed: input.seed !== undefined ? input.seed : 0,
        algorithms: input.algorithms || DEFAULT_ALGORITHMS,
        quantum: input.quantum !== undefined ? input.quantum : 2,
        hnwf: input.hnwf ? { ...DEFAULT_HNWF, ...input.hnwf } : { ...DEFAULT_HNWF },
        custom_processes: input.custom_processes || null
      };
      return request('/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    async runSimulation(params = {}) {
      const requested = params.algorithm === 'Round Robin' ? 'RR' : (params.algorithm || 'SRTF+HNWF');
      const response = await this.simulate({
        workload: params.workload || 'normal',
        seed: params.seed !== undefined ? params.seed : 0,
        algorithms: [requested],
        quantum: params.quantum !== undefined ? params.quantum : 2,
        hnwf: params.hnwf,
        custom_processes: params.custom_processes
      });
      return {
        status: response.status,
        source: response.source,
        trace_available: response.trace_available,
        algorithm: requested,
        ...(response.results[requested] || {})
      };
    },

    async runFullExperiment({ workload = 'normal', algorithms = DEFAULT_ALGORITHMS } = {}) {
      return this.simulate({ workload, seed: 'mean', algorithms });
    }
  };
})(window);
