from shortlist.models.schemas import IntakeDecision, RoleBrief
from shortlist.models.tables import Job
from shortlist.pipeline.intake import intake_step


def _job(db):
    job = Job(description_raw="need a part-time barista, weekends", status="intake")
    db.add(job)
    db.commit()
    return job


def test_ask_records_question(db, fake_llm):
    job = _job(db)
    fake_llm.queue.append(IntakeDecision(action="ask", question="What hours?", brief=RoleBrief()))
    decision = intake_step(db, job)
    assert decision.action == "ask"
    assert job.intake_history == [{"question": "What hours?", "answer": None}]


def test_answer_recorded_then_finalize(db, fake_llm):
    job = _job(db)
    fake_llm.queue.append(IntakeDecision(action="ask", question="What hours?", brief=RoleBrief()))
    intake_step(db, job)
    fake_llm.queue.append(IntakeDecision(
        action="finalize", brief=RoleBrief(title="Barista", employment_type="part_time"),
    ))
    decision = intake_step(db, job, answer="Sat-Sun 6am-2pm")
    assert decision.action == "finalize"
    assert job.intake_history[0]["answer"] == "Sat-Sun 6am-2pm"
    assert decision.brief.title == "Barista"


def test_question_cap_is_code_enforced(db, fake_llm):
    job = _job(db)
    job.intake_history = [{"question": f"q{i}", "answer": f"a{i}"} for i in range(5)]
    db.commit()
    # model tries to ask a 6th question - code forces finalize (F1.1)
    fake_llm.queue.append(IntakeDecision(action="ask", question="q6", brief=RoleBrief(title="Barista")))
    decision = intake_step(db, job, answer=None)
    assert decision.action == "finalize"
    assert len(job.intake_history) == 5
