from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from shortlist.db import get_session
from shortlist.models.schemas import Criterion
from shortlist.models.tables import (
    Application, AuditEvent, DecisionEvent, InterviewKit, Job, Rubric, ScoreReport,
)
from shortlist.pipeline.kit_gen import generate_kit

router = APIRouter(prefix="/api/applications", tags=["applications"])

VALID_ACTIONS = {"shortlist", "hold", "reject"}  # F4.2: no bulk/auto actions exist


class DecisionRequest(BaseModel):
    action: str
    note: str | None = None


def _get_application(db: Session, application_id: int) -> Application:
    app_row = db.get(Application, application_id)
    if app_row is None:
        raise HTTPException(404, "application not found")
    return app_row


@router.get("/{application_id}")
def get_application(application_id: int, db: Session = Depends(get_session)):
    a = _get_application(db, application_id)
    report = db.scalars(
        select(ScoreReport).where(ScoreReport.application_id == a.id)
        .order_by(ScoreReport.id.desc())
    ).first()
    kit = db.scalars(
        select(InterviewKit).where(InterviewKit.application_id == a.id)
        .order_by(InterviewKit.id.desc())
    ).first()
    decisions = db.scalars(
        select(DecisionEvent).where(DecisionEvent.application_id == a.id)
        .order_by(DecisionEvent.id)
    ).all()
    return {
        "id": a.id,
        "job_id": a.job_id,
        "candidate_name": a.candidate_name,
        "status": a.status,
        "raw_text": a.raw_text,
        "redacted_text": a.redacted_text,
        "parsed": a.parsed,
        "report": report.report if report else None,
        "kit": {"questions": kit.questions, "filter_results": kit.filter_results} if kit else None,
        "decisions": [
            {"action": d.action, "note": d.note, "created_at": str(d.created_at)}
            for d in decisions
        ],
    }


@router.post("/{application_id}/decision")
def record_decision(application_id: int, body: DecisionRequest,
                    db: Session = Depends(get_session)):
    if body.action not in VALID_ACTIONS:
        raise HTTPException(422, "action must be one of shortlist|hold|reject")
    a = _get_application(db, application_id)
    db.add(DecisionEvent(application_id=a.id, action=body.action, note=body.note))
    db.add(AuditEvent(job_id=a.job_id, application_id=a.id, kind="decision",
                      payload={"action": body.action, "note": body.note}))
    db.commit()
    return {"ok": True}


@router.post("/{application_id}/kit")
def create_kit(application_id: int, db: Session = Depends(get_session)):
    a = _get_application(db, application_id)
    job = db.get(Job, a.job_id)
    rubric = db.scalars(
        select(Rubric).where(Rubric.job_id == a.job_id)
        .order_by(Rubric.version.desc(), Rubric.id.desc())
    ).first()
    if rubric is None:
        raise HTTPException(409, "job has no rubric yet - complete intake first")
    criteria = [Criterion(**c) for c in rubric.criteria]
    kit, verdicts = generate_kit(db, a, job, criteria)
    return {
        "questions": [q.model_dump() for q in kit.questions],
        "filter_results": [v.model_dump() for v in verdicts],
    }
