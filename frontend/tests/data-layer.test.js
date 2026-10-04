'use strict';

const assert = require('node:assert/strict');

global.window = { location: { hostname: '127.0.0.1' } };
require('../js/api.js');
require('../js/data-adapters.js');
require('../js/store.js');

const hnwf = {
  metrics: { avg_waiting_time: 12.5, weighted_service_fairness: 0.98 },
  slices: [{ decision_id: 1, pid: 'P1', start: 0, end: 2, duration: 2, reason: 'FAIRNESS_DEBT', protected: false }],
  fairness_trace: [{
    decision_id: 1, time: 0, base_proposed_pid: 'P2', selected_pid: 'P1', candidates: [
      { pid: 'P1', fairness_debt: 0.4, vruntime: 1, service_gap: 0, boost: 0, guard_eligible: false, starvation_probability: 0.82, unfairness_probability: 0.71 }
    ]
  }],
  guard_events: [],
  processes: [{ pid: 'P1', actual_service: 2, ideal_service: 2, max_service_gap: 0, guard_activations: 0 }]
};

assert.deepEqual(window.FairnessData.comparison({ results: { 'SRTF+HNWF': hnwf } }, 'avg_waiting_time'), [
  { algorithm: 'SRTF+HNWF', value: 12.5, available: true }
]);
assert.equal(window.FairnessData.timeline(hnwf)[0].duration, 2);
assert.equal(window.FairnessData.timeline(hnwf)[0].decisionId, 1);
assert.equal(window.FairnessData.fairnessSeries(hnwf)[0].points[0].selected, true);
assert.equal(window.FairnessData.fairnessSeries(hnwf)[0].points[0].starvationRisk, 0.82);
assert.equal(window.FairnessData.processRows(hnwf)[0].serviceRatio, 1);
assert.equal(window.SchedulerAPI.defaultHnwf.gmax, 32);
assert.equal(window.SchedulerStore.getState().selectedAlgorithm, 'SRTF+HNWF');
assert.ok(window.SchedulerAPI.algorithms.includes('Priority+HNWF'));
assert.equal(window.SchedulerAPI.algorithms.includes('HNWF'), false);

console.log('frontend data-layer tests passed');
