/**
 * app.js — Main Application Bootstrap & Coordinator
 * CPU Scheduling Analyzer (Phase 1 Baseline)
 */

(function (window) {
  'use strict';

  window.addEventListener('DOMContentLoaded', () => {
    console.log('[App] Initializing CPU Scheduling Analyzer Frontend...');

    // Initialize client-side navigation & routing (handles initial route mount automatically)
    if (window.Navigation) {
      window.Navigation.init();
    }

    console.log('[App] Frontend system ready.');
  });

})(window);
