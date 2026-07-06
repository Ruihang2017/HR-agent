import pytest

from shortlist.llm.client import LLMCallError, call_structured
from shortlist.models.schemas import ScoreRationale
from shortlist.models.tables import AuditEvent


def test_success_writes_audit_event(db, fake_llm):
    fake_llm.queue.append(ScoreRationale(rationale="strong fit"))
    out = call_structured(
        db, stage="score", prompt_name="score_rationale",
        variables={"results": "[]"}, output_model=ScoreRationale,
    )
    assert out.rationale == "strong fit"
    audit = db.query(AuditEvent).one()
    assert audit.kind == "model_call"
    assert audit.stage == "score"
    assert audit.prompt_name == "score_rationale"
    assert audit.input_tokens == 10
    # the call used the strong model and NO sampling params
    kwargs = fake_llm.calls[0]
    assert kwargs["model"] == "claude-opus-4-8"
    assert "temperature" not in kwargs


def test_retries_once_then_succeeds(db, fake_llm):
    fake_llm.queue.extend([RuntimeError("transient"), ScoreRationale(rationale="ok")])
    out = call_structured(
        db, stage="score", prompt_name="score_rationale",
        variables={"results": "[]"}, output_model=ScoreRationale,
    )
    assert out.rationale == "ok"
    assert len(fake_llm.calls) == 2


def test_two_failures_raises_and_audits(db, fake_llm):
    fake_llm.queue.extend([RuntimeError("a"), RuntimeError("b")])
    with pytest.raises(LLMCallError):
        call_structured(
            db, stage="score", prompt_name="score_rationale",
            variables={"results": "[]"}, output_model=ScoreRationale,
        )
    audit = db.query(AuditEvent).one()
    assert audit.kind == "model_call_failed"


def test_cache_system_sets_cache_control(db, fake_llm):
    fake_llm.queue.append(ScoreRationale(rationale="x"))
    call_structured(
        db, stage="score", prompt_name="score_rationale",
        variables={"results": "[]"}, output_model=ScoreRationale, cache_system=True,
    )
    system = fake_llm.calls[0]["system"]
    assert system[0]["cache_control"] == {"type": "ephemeral"}
