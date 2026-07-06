import json

from sqlalchemy.orm import Session

from shortlist.config import settings
from shortlist.llm.client import call_structured
from shortlist.models.schemas import IntakeDecision
from shortlist.models.tables import Job


def intake_step(db: Session, job: Job, answer: str | None = None) -> IntakeDecision:
    """One turn of the bounded intake interview. The model proposes; code disposes."""
    history = list(job.intake_history or [])
    if answer is not None and history:
        history[-1] = {**history[-1], "answer": answer}

    decision = call_structured(
        db,
        stage="intake",
        prompt_name="intake",
        variables={"description": job.description_raw, "history": json.dumps(history)},
        output_model=IntakeDecision,
        job_id=job.id,
    )

    if decision.action == "ask" and len(history) >= settings.max_intake_questions:
        # F1.1: max ~5 questions, sensible defaults otherwise. Enforced in code, not prompts.
        decision = IntakeDecision(action="finalize", question=None, brief=decision.brief)

    if decision.action == "ask":
        history.append({"question": decision.question, "answer": None})

    job.intake_history = history
    db.commit()
    return decision
