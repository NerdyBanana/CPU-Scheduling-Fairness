/**
 * navigation.js — Client-Side Router & Persistent Navigation Controller
 * CPU Scheduling Analyzer (Phase 1 Baseline)
 */

(function (window) {
  'use strict';

  // Routes registry
  const ROUTES = {
    'dashboard': {
      title: 'Executive Overview',
      templateId: 'tpl-dashboard'
    },
    'simulation': {
      title: 'CPU Simulation & Execution',
      templateId: 'tpl-simulation'
    },
    'performance': {
      title: 'Performance Benchmark',
      templateId: 'tpl-performance'
    },
    'fairness': {
      title: 'Fairness & Starvation Analysis',
      templateId: 'tpl-fairness'
    },
    'execution-analysis': {
      title: 'Execution Analysis',
      templateId: 'tpl-execution-analysis'
    },
    'phase2': {
      title: 'Phase 2: Adaptive Scheduling Roadmap',
      templateId: 'tpl-phase2'
    }
  };

  const DEFAULT_ROUTE = 'dashboard';

  window.Navigation = {
    currentRoute: '',

    init: function () {
      // Listen to URL hash changes
      window.addEventListener('hashchange', () => this.handleRouting());

      // Bind nav links
      document.querySelectorAll('.nav-item').forEach(link => {
        link.addEventListener('click', (e) => {
          const route = link.getAttribute('data-route');
          if (route) {
            window.location.hash = route;
            this.closeMobileDrawer();
          }
        });
      });

      // Mobile Menu Toggle
      const mobileBtn = document.getElementById('btn-mobile-menu');
      if (mobileBtn) {
        mobileBtn.addEventListener('click', () => this.toggleMobileDrawer());
      }

      // Initial route resolution
      this.handleRouting();
    },

    handleRouting: function () {
      let hash = window.location.hash.replace('#', '').toLowerCase().trim();
      // Handle legacy aliases
      if (hash === 'gantt' || hash === 'analysis') {
        hash = 'execution-analysis';
      } else if (hash === 'workloads') {
        hash = 'simulation';
      }

      if (!hash || !ROUTES[hash]) {
        hash = DEFAULT_ROUTE;
      }

      this.currentRoute = hash;
      this.renderView(hash);
      this.updateActiveNav(hash);
      this.updateBreadcrumbs(ROUTES[hash].title);
    },

    renderView: function (routeKey) {
      const container = document.getElementById('app-content');
      if (!container) return;

      const routeConfig = ROUTES[routeKey];
      const template = document.getElementById(routeConfig.templateId);

      if (template) {
        // Clone template content into container
        container.innerHTML = '';
        container.appendChild(template.content.cloneNode(true));
      } else {
        container.innerHTML = `
          <div class="view-header">
            <h1 class="view-title">${routeConfig.title}</h1>
            <p class="view-subtitle">Module initialized.</p>
          </div>
        `;
      }

      // Trigger lifecycle hooks if route has specific initializer
      switch (routeKey) {
        case 'dashboard':
          if (window.DashboardController) window.DashboardController.mount();
          break;
        case 'simulation':
          if (window.SimulationController) window.SimulationController.mount();
          break;
        case 'workloads':
          if (window.WorkloadManager) window.WorkloadManager.mount();
          break;
        case 'performance':
        case 'fairness':
          if (window.ChartsController) window.ChartsController.mount();
          break;
        case 'execution-analysis':
          if (window.ExecutionAnalysisController) {
            window.ExecutionAnalysisController.mount();
          } else if (window.GanttController) {
            window.GanttController.mount();
          }
          break;
        default:
          break;
      }
    },


    updateActiveNav: function (routeKey) {
      document.querySelectorAll('.nav-item').forEach(link => {
        if (link.getAttribute('data-route') === routeKey) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      });
    },

    updateBreadcrumbs: function (pageTitle) {
      const breadcrumbEl = document.getElementById('current-page-crumb');
      if (breadcrumbEl) {
        breadcrumbEl.textContent = pageTitle;
      }
    },

    toggleMobileDrawer: function () {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.classList.toggle('drawer-open');
    },

    closeMobileDrawer: function () {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.classList.remove('drawer-open');
    }
  };

})(window);
