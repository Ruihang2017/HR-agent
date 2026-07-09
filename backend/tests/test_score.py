from shortlist.models.schemas import (
    Criterion, CriterionEval, CriterionType, ScoreRationale,
)
from shortlist.models.tables import Application, Job, ScoreReport
from shortlist.pipeline.score import score_application

CRITERIA = [
    Criterion(name="Right to work", type=CriterionType.must_have, evidence_guidance="g"),
    Criterion(name="Espresso skill", type=CriterionType.weighted, weight=0.6, evidence_guidance="g"),
    Criterion(name="Opens solo", type=CriterionType.weighted, weight=0.4, evidence_guidance="g"),
]


def _scored_app(db):
    job = Job(description_raw="barista", status="ready")
    db.add(job)
    db.commit()
    app_row = Application(job_id=job.id, candidate_name="A", status="parsed",
                          raw_text="x", redacted_text="[NAME] made coffee")
    db.add(app_row)
    db.commit()
    return app_row


def test_scores_each_criterion_and_aggregates(db, fake_llm):
    app_row = _scored_app(db)
    fake_llm.queue.extend([
        CriterionEval(met=True, evidence="has right to work"),
        CriterionEval(score=4, evidence="4 years espresso"),
        CriterionEval(score=2, evidence="no solo opening mentioned"),
        ScoreRationale(rationale="Strong coffee skills, unproven on solo opens."),
    ])

    report = score_application(db, app_row, CRITERIA)

    # weighted mean: (4*0.6 + 2*0.4) / 1.0 = 3.2
    assert report.overall == 3.2
    assert report.meets_all_must_haves is True
    assert len(report.results) == 3
    assert app_row.status == "scored"
    row = db.query(ScoreReport).filter_by(application_id=app_row.id).one()
    assert row.overall == 3.2
    assert row.prompt_version == 1
    # scoring calls lead with the stable system prefix (enables OpenAI's automatic caching)
    scoring_calls = [c for c in fake_llm.calls if "Criterion (JSON)" in c["messages"][1]["content"]]
    assert scoring_calls and all(c["messages"][0]["role"] == "system" for c in scoring_calls)


def test_failed_must_have_never_rejects(db, fake_llm):
    app_row = _scored_app(db)
    fake_llm.queue.extend([
        CriterionEval(met=False, evidence="no evidence found"),
        CriterionEval(score=5, evidence="great"),
        CriterionEval(score=5, evidence="great"),
        ScoreRationale(rationale="Did not evidence right to work."),
    ])
    report = score_application(db, app_row, CRITERIA)
    assert report.meets_all_must_haves is False
    # F3.3: still scored, still visible - status is 'scored', NOT rejected
    assert app_row.status == "scored"
