/** Pure adapters from the backend contract to interactive chart/view models. */
(function (window) {
  'use strict';

  function metricValue(result, metric) {
    if (!result || !result.metrics || result.metrics[metric] === undefined) return null;
    const value = result.metrics[metric];
    return value && typeof value === 'object' && 'mean' in value ? value.mean : value;
  }

  function comparison(response, metric) {
    if (!response || !response.results) return [];
    return Object.entries(response.results).map(([algorithm, result]) => ({
      algorithm,
      value: metricValue(result, metric),
      available: metricValue(result, metric) !== null
    }));
  }

  function timeline(result) {
    return (result && result.slices ? result.slices : []).map((slice) => ({
      id: `${slice.decision_id}-${slice.pid}-${slice.start}`,
      decisionId: slice.decision_id,
      pid: slice.pid,
      start: slice.start,
      end: slice.end,
      duration: slice.duration,
      reason: slice.reason,
      protected: Boolean(slice.protected),
      contextSwitch: Boolean(slice.context_switch_before)
    }));
  }

  function fairnessSeries(result) {
    const byPid = new Map();
    for (const decision of (result && result.fairness_trace ? result.fairness_trace : [])) {
      for (const candidate of (decision.candidates || [])) {
        if (!byPid.has(candidate.pid)) byPid.set(candidate.pid, []);
        byPid.get(candidate.pid).push({
          time: decision.time,
          debt: candidate.fairness_debt,
          vruntime: candidate.vruntime,
          serviceGap: candidate.service_gap,
          boost: candidate.boost,
          selected: decision.selected_pid === candidate.pid,
          baseSelected: decision.base_proposed_pid === candidate.pid || Boolean(candidate.base_selected),
          starvationRisk: candidate.starvation_probability,
          unfairnessRisk: candidate.unfairness_probability,
          guardEligible: Boolean(candidate.guard_eligible)
        });
      }
    }
    return Array.from(byPid, ([pid, points]) => ({ pid, points }));
  }

  function guardMarkers(result) {
    return (result && result.guard_events ? result.guard_events : []).map((event) => ({
      pid: event.pid,
      time: event.trigger_time,
      gap: event.observed_gap,
      target: event.gmax,
      serviceStart: event.service_start,
      serviceEnd: event.service_end,
      resolved: Boolean(event.resolved)
    }));
  }

  function processRows(result) {
    return (result && result.processes ? result.processes : []).map((process) => ({
      ...process,
      serviceRatio: process.ideal_service > 0
        ? Number((process.actual_service / process.ideal_service).toFixed(4))
        : null,
      fairnessStatus: process.max_service_gap > 32 ? 'target-exceeded'
        : process.guard_activations > 0 ? 'guarded' : 'normal'
    }));
  }

  window.FairnessData = { metricValue, comparison, timeline, fairnessSeries, guardMarkers, processRows };
})(window);
