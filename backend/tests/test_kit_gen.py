from shortlist.models.schemas import (
    Criterion, CriterionType, InterviewKitSchema, KitQuestion,
)
from shortlist.models.tables import Application, InterviewKit, Job
from shortlist.pipeline.kit_gen import check_manual_question, generate_kit

CRITERIA = [Criterion(name="Espresso skill", type=CriterionType.weighted, weight=1.0,
                      evidence_guidance="g")]


def test_kit_generated_and_filtered(db, fake_llm):
    job = Job(description_raw="barista", title="Barista", status="screened")
    db.add(job)
    db.commit()
    app_row = Application(job_id=job.id, candidate_name="A", status="scored",
                          redacted_text="[NAME] made coffee")
    db.add(app_row)
    db.commit()
    fake_llm.queue.append(InterviewKitSchema(questions=[
        KitQuestion(text="Tell me about a rush you handled solo.",
                    category="behavioural", listen_for="calm under pressure",
                    criterion_name="Espresso skill"),
    ]))

    kit, verdicts = generate_kit(db, app_row, job, CRITERIA)

    assert len(kit.questions) == 1
    assert len(verdicts) == 1
    row = db.query(InterviewKit).filter_by(application_id=app_row.id).one()
    assert row.questions[0]["category"] == "behavioural"
    assert row.filter_results[0]["implemented"] is False  # stub filter, honestly labelled


def test_manual_question_goes_through_filter(db, fake_llm):
    verdict = check_manual_question(db, application_id=1, question="Are you a citizen?")
    assert verdict.allowed is True          # stub allows everything...
    assert verdict.implemented is False     # ...and says it isn't real yet
