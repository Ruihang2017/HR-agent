from datetime import datetime, timezone

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from shortlist.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    description_raw: Mapped[str] = mapped_column(Text)
    intake_history: Mapped[list] = mapped_column(JSON, default=list)
    jd_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    lint_results: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String, default="intake")  # intake|ready|screening|screened
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Rubric(Base):
    __tablename__ = "rubrics"
    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))
    criteria: Mapped[list] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)


class Application(Base):
    __tablename__ = "applications"
    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"))
    candidate_name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, default="")
    file_path: Mapped[str | None] = mapped_column(String, nullable=True)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    redacted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="received")  # received|parsed|scored|needs_manual_review
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class ScoreReport(Base):
    __tablename__ = "score_reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"))
    report: Mapped[dict] = mapped_column(JSON)
    overall: Mapped[float] = mapped_column(Float)
    model: Mapped[str] = mapped_column(String, default="")
    prompt_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class DecisionEvent(Base):
    __tablename__ = "decision_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"))
    actor: Mapped[str] = mapped_column(String, default="owner")
    action: Mapped[str] = mapped_column(String)  # shortlist|hold|reject
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class InterviewKit(Base):
    __tablename__ = "interview_kits"
    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"))
    questions: Mapped[list] = mapped_column(JSON)
    filter_results: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    application_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String)  # model_call|model_call_failed|decision
    stage: Mapped[str | None] = mapped_column(String, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    prompt_name: Mapped[str | None] = mapped_column(String, nullable=True)
    prompt_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
