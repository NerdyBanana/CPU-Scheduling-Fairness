from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
UI_SCRIPT = (ROOT / "frontend" / "js" / "phase2-ui.js").read_text(encoding="utf-8")
UI_CSS = (ROOT / "frontend" / "css" / "phase2-ui.css").read_text(encoding="utf-8")


def test_four_required_views_are_present_once():
    for view in ("overview", "simulation", "fairness", "process"):
        assert INDEX.count(f'data-view-panel="{view}"') == 1
        assert INDEX.count(f'data-view="{view}"') == 1


def test_frontend_loads_phase2_data_stack_in_order():
    scripts = ["js/api.js", "js/data-adapters.js", "js/store.js", "js/phase2-ui.js"]
    positions = [INDEX.index(script) for script in scripts]
    assert positions == sorted(positions)


def test_ui_contains_linked_fairness_surfaces():
    required_ids = {
        "overview-chart", "execution-timeline", "fairness-comparison-chart",
        "starvation-comparison-chart", "ml-intervention-chart", "fairness-pair-detail",
        "process-select", "state-orbit", "formula-steps",
    }
    for element_id in required_ids:
        assert f'id="{element_id}"' in INDEX


def test_simulator_exposes_algorithm_selection_and_hnwf_toggle():
    for algorithm in ("FCFS", "SJF", "SRTF", "RR", "Priority"):
        assert f'name="base-algorithm" value="{algorithm}"' in INDEX
    assert 'name="base-algorithm" value="HNWF"' not in INDEX
    assert 'id="control-fairness"' in INDEX
    assert 'id="control-focus-algorithm"' in INDEX
    assert "HNWF Fairness Supervisor" in INDEX
    assert "selectedBases.flatMap" in UI_SCRIPT
    assert "`${name}+HNWF`" in UI_SCRIPT
    assert "algorithms:selectedAlgorithms" in UI_SCRIPT


def test_simulation_has_trace_driven_playback_controls():
    for element_id in ("playback-toggle", "playback-step", "playback-reset", "playback-range", "timeline-explanation", "timeline-playhead"):
        assert element_id in INDEX or element_id in UI_SCRIPT
    assert "FairnessData.timeline(activeResult())" in UI_SCRIPT
    assert "updatePlaybackUi" in UI_SCRIPT
    assert "requestAnimationFrame" in UI_SCRIPT
    assert 'value="0.25"' in INDEX
    assert 'value="0.5"' in INDEX
    assert 'value="0.75"' in INDEX
    assert 'id="timeline-explanation"' in INDEX
    assert "process-editor-body" not in INDEX
    assert "algorithm-comparison-body" not in INDEX


def test_simulation_visualizes_circular_process_lifecycle():
    for element_id in (
        "os-ready-queue", "os-scheduler-name", "os-base-choice", "os-final-choice",
        "os-supervisor-state", "hardware-core", "core-process", "os-process-packet",
        "cycle-return-title", "cycle-return-detail", "cycle-ready-count",
    ):
        assert f'id="{element_id}"' in INDEX
    assert "Follow one process around the CPU cycle." in INDEX
    assert '<i aria-hidden="true">✦</i></div>' in INDEX
    assert "packet.querySelector('small')" not in UI_SCRIPT
    assert "packet.querySelector('strong')" not in UI_SCRIPT
    assert "packet.setAttribute('aria-label'" in UI_SCRIPT
    assert "Run the scheduler in 3D." not in INDEX
    assert 'id="simulation-cube"' not in INDEX
    for explanation in (
        "Oldest ready process", "Shortest ready burst", "Least remaining CPU time",
        "requeues if unfinished", "Lowest priority number",
    ):
        assert explanation in UI_SCRIPT
    assert "algorithmBehavior(activeAlgorithm)" in UI_SCRIPT
    assert "HNWF · REDIRECTED" in UI_SCRIPT
    assert "Math.cos(angle)" in UI_SCRIPT
    assert "Math.sin(angle)" in UI_SCRIPT
    assert "data-cycle-phase" in INDEX
    assert ".cycle-orbit { position:relative; grid-column:1/-1; justify-self:center;" in UI_CSS
    assert "Math.cos(angle)*27" in UI_SCRIPT
    assert ".process-star::after { content:none; }" in UI_CSS
    assert "document.startViewTransition(updatePanels)" in UI_SCRIPT
    assert "::view-transition-new(active-view)" in UI_CSS


def test_tech_type_and_staggered_page_panels_are_present():
    assert "family=Oxanium" in INDEX
    assert "--sans: 'Oxanium'" in UI_CSS
    assert "@keyframes panelReveal" in UI_CSS
    assert ".view.active :is(.card,.metric-card,.control-bar,.fairness-toolbar,.process-selector)" in UI_CSS
    assert "animation-delay:.29s" in UI_CSS


def test_metric_explorer_compares_selected_algorithms_by_metric():
    assert 'id="metric-algorithms"' in INDEX
    assert "definitions[selectedMetric]" in UI_SCRIPT
    assert "metric-bar-row" in UI_SCRIPT
    assert "metricAlgorithms" in UI_SCRIPT


def test_fairness_page_compares_base_and_hnwf_with_interactive_columns():
    assert "Fairness &amp; starvation" in INDEX
    assert 'id="fairness-pair-select"' in INDEX
    assert "Jain waiting-time fairness" in INDEX
    assert "Starved processes: base vs HNWF" in INDEX
    assert "Why the supervisor intervened" in INDEX
    assert "renderPairedColumns" in UI_SCRIPT
    assert "ml_starvation_interventions" in UI_SCRIPT
    assert "ml_unfairness_interventions" in UI_SCRIPT
    assert "data-fairness-base" in UI_SCRIPT
    assert "Starvation uses the same threshold" in UI_SCRIPT


def test_process_explorer_supports_every_process_and_plain_language_steps():
    for element_id in ("process-algorithm-select", "process-select", "process-position", "process-prev", "process-next"):
        assert f'id="{element_id}"' in INDEX
    assert ".slice(0,8)" not in UI_SCRIPT
    assert "Process journey in simple words" in INDEX
    assert "supervisedPolicies" in UI_SCRIPT
    assert "selectProcessAlgorithm" in UI_SCRIPT
    assert "baseProposals" in UI_SCRIPT
    assert "Peak starvation" in UI_SCRIPT
    assert "HNWF action" in UI_SCRIPT


def test_process_state_spheres_expose_values_and_animation():
    assert "Hover or focus a sphere" in INDEX
    assert 'class="state-node' in UI_SCRIPT
    assert 'data-value=' in UI_SCRIPT
    assert 'aria-label=' in UI_SCRIPT
    assert "--node-color" in UI_SCRIPT


def test_demo_fallback_is_explicit_and_live_data_is_preferred():
    assert "Backend unavailable — showing clearly marked demo data." in UI_SCRIPT
    assert "policy results on the same workload." in UI_SCRIPT
    assert "window.SchedulerStore.run" in UI_SCRIPT
