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
    assert kwargs["model"] == "gpt-4o"
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


def test_system_prompt_leads_messages_for_caching(db, fake_llm):
    # OpenAI caches long, stable prompt prefixes automatically. We keep the system
    # prompt first and byte-identical so those cache hits land across a scoring run.
    fake_llm.queue.append(ScoreRationale(rationale="x"))
    call_structured(
        db, stage="score", prompt_name="score_rationale",
        variables={"results": "[]"}, output_model=ScoreRationale, cache_system=True,
    )
    messages = fake_llm.calls[0]["messages"]
    assert messages[0]["role"] == "system"
    assert "temperature" not in fake_llm.calls[0]
