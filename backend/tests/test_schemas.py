import pytest
from pydantic import ValidationError

from shortlist.models.schemas import (
    Criterion,
    CriterionEval,
    CriterionType,
    IntakeDecision,
    RoleBrief,
    RubricSchema,
)


def test_rubric_requires_at_least_one_criterion():
    with pytest.raises(ValidationError):
        RubricSchema(criteria=[])


def test_criterion_weight_bounds():
    with pytest.raises(ValidationError):
        Criterion(name="x", type=CriterionType.weighted, weight=1.5, evidence_guidance="g")


def test_criterion_eval_score_bounds():
    with pytest.raises(ValidationError):
        CriterionEval(score=6, evidence="e")
    ok = CriterionEval(met=True, evidence="worked weekends solo")
    assert ok.score is None


def test_intake_decision_shape():
    d = IntakeDecision(action="finalize", brief=RoleBrief(title="Barista"))
    assert d.question is None
    assert d.brief.must_have_skills == []
