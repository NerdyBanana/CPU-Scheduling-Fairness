from phase2.risk_model import FEATURE_NAMES, RiskPredictor


def test_frozen_dual_logistic_model_loads_and_predicts_probabilities():
    predictor = RiskPredictor.load()
    prediction = predictor.predict([0.0] * len(FEATURE_NAMES))
    assert 0.0 <= prediction.starvation_probability <= 1.0
    assert 0.0 <= prediction.unfairness_probability <= 1.0
    assert predictor.metadata["training_seeds"] == [0, 1, 2, 3, 4, 5]
    assert predictor.metadata["test_seeds"] == [8, 9]


def test_runtime_features_do_not_include_future_outcomes():
    forbidden = {"completion", "final_waiting", "turnaround", "future_arrivals", "final_debt"}
    assert forbidden.isdisjoint(FEATURE_NAMES)
