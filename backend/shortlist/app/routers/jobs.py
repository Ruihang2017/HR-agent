from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from shortlist.config import settings
from shortlist.db import get_session
from shortlist.models.tables import Application, Job, Rubric, ScoreReport
from shortlist.pipeline.intake import intake_step
from shortlist.pipeline.jd_gen import generate_jd
from shortlist.pipeline.run import screen_job
from shortlist.seeds import generate_resumes, seed_applications

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class CreateJobRequest(BaseModel):
    description: str


class IntakeAnswerRequest(BaseModel):
    answer: str


class SeedRequest(BaseModel):
    count: int = 50


def _get_job(db: Session, job_id: int) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return job


@router.post("")
def create_job(body: CreateJobRequest, db: Session = Depends(get_session)):
    job = Job(description_raw=body.description, status="intake")
    db.add(job)
    db.commit()
    decision = intake_step(db, job)
    if decision.action == "finalize":
        generate_jd(db, job, decision.brief)
    return {"job_id": job.id, "decision": decision.model_dump()}


@router.post("/{job_id}/intake")
def answer_intake(job_id: int, body: IntakeAnswerRequest, db: Session = Depends(get_session)):
    job = _get_job(db, job_id)
    decision = intake_step(db, job, answer=body.answer)
    if decision.action == "finalize":
        generate_jd(db, job, decision.brief)
    return {"job_id": job.id, "decision": decision.model_dump(), "status": job.status}


@router.get("")
def list_jobs(db: Session = Depends(get_session)):
    jobs_ = db.scalars(select(Job).order_by(Job.id.desc())).all()
    return [{"id": j.id, "title": j.title, "status": j.status} for j in jobs_]


@router.get("/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_session)):
    job = _get_job(db, job_id)
    rubric = db.scalars(select(Rubric).where(Rubric.job_id == job_id)).first()
    return {
        "id": job.id,
        "title": job.title,
        "status": job.status,
        "jd_markdown": job.jd_markdown,
        "lint_results": job.lint_results,
        "intake_history": job.intake_history,
        "rubric": rubric.criteria if rubric else None,
    }


@router.post("/{job_id}/seed")
def seed(job_id: int, body: SeedRequest, db: Session = Depends(get_session)):
    _get_job(db, job_id)
    resume_dir = settings.data_dir / "synthetic"
    generate_resumes(resume_dir, count=body.count)
    return {"seeded": seed_applications(db, job_id, resume_dir)}


def _screen_task(job_id: int) -> None:
    from shortlist.db import SessionLocal  # late import so tests can patch it

    db = SessionLocal()
    try:
        screen_job(db, job_id)
    finally:
        db.close()


@router.post("/{job_id}/screen")
def screen(job_id: int, background: BackgroundTasks, db: Session = Depends(get_session)):
    job = _get_job(db, job_id)
    job.status = "screening"
    db.commit()
    background.add_task(_screen_task, job_id)
    return {"status": "screening"}


@router.get("/{job_id}/applications")
def list_applications(job_id: int, db: Session = Depends(get_session)):
    _get_job(db, job_id)
    apps = db.scalars(select(Application).where(Application.job_id == job_id)).all()
    rows = []
    for a in apps:
        report = db.scalars(
            select(ScoreReport)
            .where(ScoreReport.application_id == a.id)
            .order_by(ScoreReport.id.desc())
        ).first()
        rows.append({
            "id": a.id,
            "candidate_name": a.candidate_name,
            "status": a.status,
            "overall": report.overall if report else None,
            "meets_all_must_haves": report.report["meets_all_must_haves"] if report else None,
            "rationale": report.report["rationale"] if report else None,
        })
    rows.sort(key=lambda r: (r["overall"] is None, -(r["overall"] or 0)))
    return rows
