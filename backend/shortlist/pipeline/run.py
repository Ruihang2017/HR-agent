from sqlalchemy import select
from sqlalchemy.orm import Session

from shortlist.llm.client import LLMCallError
from shortlist.models.schemas import Criterion
from shortlist.models.tables import Application, Job, Rubric
from shortlist.pipeline.parse import parse_application
from shortlist.pipeline.redact import redact_application
from shortlist.pipeline.score import score_application


def screen_job(db: Session, job_id: int) -> None:
    """Parse -> redact -> score every application. One candidate's failure never
    aborts the run - it flags that candidate for manual review (honesty-in-failure)."""
    job = db.get(Job, job_id)
    rubric = db.scalars(
        select(Rubric).where(Rubric.job_id == job_id)
        .order_by(Rubric.version.desc(), Rubric.id.desc())
    ).first()
    if rubric is None:
        raise ValueError(f"screen_job called for job {job_id} with no rubric")
    criteria = [Criterion(**c) for c in rubric.criteria]
    job.status = "screening"
    db.commit()

    applications = db.scalars(
        select(Application).where(Application.job_id == job_id)
    ).all()
    for app_row in applications:
        try:
            if app_row.status == "received":
                parse_application(db, app_row)
            if app_row.status == "parsed":
                redact_application(db, app_row)
                score_application(db, app_row, criteria)
        except LLMCallError:
            app_row.status = "needs_manual_review"
            db.commit()

    job.status = "screened"
    db.commit()
