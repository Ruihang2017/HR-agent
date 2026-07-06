from shortlist.config import STAGE_MODELS, settings


def test_stage_models_cover_all_pipeline_stages():
    assert set(STAGE_MODELS) == {
        "parse", "redact", "intake", "jd_gen", "lint", "score", "kit_gen", "question_filter",
    }


def test_model_tiering():
    assert STAGE_MODELS["parse"] == settings.model_fast
    assert STAGE_MODELS["redact"] == settings.model_fast
    assert STAGE_MODELS["score"] == settings.model_strong
    assert STAGE_MODELS["jd_gen"] == settings.model_strong
