from sqlalchemy.orm import Session

from shortlist.llm.client import LLMCallError, call_structured
from shortlist.models.schemas import ParsedResume
from shortlist.models.tables import Application


def parse_application(db: Session, application: Application) -> None:
    """Raw resume text -> ParsedResume (Haiku). Failure flags manual review, never drops."""
    if not application.raw_text:
        application.status = "needs_manual_review"
        db.commit()
        return
    try:
        parsed = call_structured(
            db,
            stage="parse",
            prompt_name="parse",
            variables={"resume_text": application.raw_text},
            output_model=ParsedResume,
            job_id=application.job_id,
            application_id=application.id,
        )
    except LLMCallError:
        application.status = "needs_manual_review"
        db.commit()
        return
    application.parsed = parsed.model_dump()
    application.status = "parsed"
    db.commit()
