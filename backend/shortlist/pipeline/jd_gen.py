from sqlalchemy.orm import Session

from shortlist.guardrails.base import get_linter
from shortlist.llm.client import call_structured
from shortlist.models.schemas import JDOutput, RoleBrief
from shortlist.models.tables import Job, Rubric


def generate_jd(db: Session, job: Job, brief: RoleBrief) -> JDOutput:
    """Brief -> JD + rubric (the contract for all downstream stages), lint slot applied."""
    out = call_structured(
        db,
        stage="jd_gen",
        prompt_name="jd_gen",
        variables={"brief": brief.model_dump_json()},
        output_model=JDOutput,
        job_id=job.id,
    )
    lint = get_linter().lint(out.jd_markdown, raw_inputs=job.description_raw)

    job.title = out.title
    job.jd_markdown = out.jd_markdown
    job.lint_results = lint.model_dump()
    job.status = "ready"
    db.add(Rubric(job_id=job.id, criteria=[c.model_dump() for c in out.rubric.criteria], version=1))
    db.commit()
    return out
