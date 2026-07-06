from shortlist.models.schemas import ParsedResume, WorkHistoryItem
from shortlist.models.tables import Application, Job
from shortlist.pipeline.parse import parse_application
from shortlist.pipeline.redact import redact_application


def _make_app(db, raw_text):
    job = Job(description_raw="barista", status="ready")
    db.add(job)
    db.commit()
    app_row = Application(
        job_id=job.id, candidate_name="Alex Chen",
        email="alex.chen@example.com", raw_text=raw_text, status="received",
    )
    db.add(app_row)
    db.commit()
    return app_row


def test_parse_populates_structured_data(db, fake_llm):
    app_row = _make_app(db, "Alex Chen\nBarista, Beans & Co, 3 years")
    fake_llm.queue.append(ParsedResume(
        work_history=[WorkHistoryItem(role="Barista", employer="Beans & Co", duration="3 years")],
        skills=["espresso"],
    ))
    parse_application(db, app_row)
    assert app_row.status == "parsed"
    assert app_row.parsed["work_history"][0]["employer"] == "Beans & Co"


def test_parse_without_text_flags_manual_review(db, fake_llm):
    app_row = _make_app(db, None)
    parse_application(db, app_row)
    assert app_row.status == "needs_manual_review"
    assert fake_llm.calls == []


def test_parse_llm_failure_flags_manual_review(db, fake_llm):
    app_row = _make_app(db, "some text")
    fake_llm.queue.extend([RuntimeError("boom"), RuntimeError("boom")])
    parse_application(db, app_row)
    assert app_row.status == "needs_manual_review"


def test_redact_uses_slot_and_candidate_name(db, fake_llm):
    app_row = _make_app(db, "Alex Chen\nalex.chen@example.com\nBarista since 2019")
    redact_application(db, app_row)
    assert "Alex" not in app_row.redacted_text
    assert "[EMAIL]" in app_row.redacted_text
    assert "2019" not in app_row.redacted_text
