from sqlalchemy.orm import Session

from shortlist.guardrails.base import get_redactor
from shortlist.models.tables import Application


def redact_application(db: Session, application: Application) -> None:
    """Produce the identity-blind text the scoring model will see (F3.1)."""
    redactor = get_redactor()
    application.redacted_text = redactor.redact(
        application.raw_text or "", known_names=[application.candidate_name]
    )
    db.commit()
