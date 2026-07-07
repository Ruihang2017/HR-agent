import json

from sqlalchemy.orm import Session

from shortlist.guardrails.base import get_question_filter
from shortlist.llm.client import call_structured
from shortlist.models.schemas import Criterion, FilterVerdict, InterviewKitSchema
from shortlist.models.tables import Application, InterviewKit, Job


def generate_kit(
    db: Session, application: Application, job: Job, criteria: list[Criterion]
) -> tuple[InterviewKitSchema, list[FilterVerdict]]:
    """Tailored kit per shortlisted candidate; every question through the filter slot (F5.3)."""
    kit = call_structured(
        db,
        stage="kit_gen",
        prompt_name="kit_gen",
        variables={
            "title": job.title or "",
            "rubric": json.dumps([c.model_dump() for c in criteria]),
            "resume_text": application.redacted_text or "",
        },
        output_model=InterviewKitSchema,
        job_id=job.id,
        application_id=application.id,
    )
    qfilter = get_question_filter()
    verdicts = [qfilter.check(q.text) for q in kit.questions]
    kept = [q for q, v in zip(kit.questions, verdicts) if v.allowed]
    filtered_kit = InterviewKitSchema(questions=kept)
    db.add(
        InterviewKit(
            application_id=application.id,
            questions=[q.model_dump() for q in filtered_kit.questions],
            filter_results=[v.model_dump() for v in verdicts],
        )
    )
    db.commit()
    return filtered_kit, verdicts


def check_manual_question(db: Session, application_id: int, question: str) -> FilterVerdict:
    """Owner-typed questions get the same filter as generated ones (F5.3)."""
    return get_question_filter().check(question)
