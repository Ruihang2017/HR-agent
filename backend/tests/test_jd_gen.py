from shortlist.models.schemas import (
    Criterion, CriterionType, JDOutput, RoleBrief, RubricSchema,
)
from shortlist.models.tables import Job, Rubric
from shortlist.pipeline.jd_gen import generate_jd


def test_generate_jd_stores_jd_rubric_and_lint(db, fake_llm):
    job = Job(description_raw="barista", status="intake")
    db.add(job)
    db.commit()
    fake_llm.queue.append(JDOutput(
        title="Part-time Barista",
        jd_markdown="# Barista\nAbout the role...",
        rubric=RubricSchema(criteria=[
            Criterion(name="Right to work in Australia", type=CriterionType.must_have,
                      evidence_guidance="States right to work"),
            Criterion(name="Espresso experience", type=CriterionType.weighted, weight=1.0,
                      evidence_guidance="Barista roles, coffee training"),
        ]),
    ))

    out = generate_jd(db, job, RoleBrief(title="Barista", employment_type="part_time"))

    assert out.title == "Part-time Barista"
    assert job.status == "ready"
    assert job.jd_markdown.startswith("# Barista")
    assert job.lint_results["implemented"] is False  # stub linter, honestly labelled
    rubric = db.query(Rubric).filter_by(job_id=job.id).one()
    assert len(rubric.criteria) == 2
    assert rubric.criteria[0]["type"] == "must_have"
