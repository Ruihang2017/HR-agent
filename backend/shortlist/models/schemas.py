from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class CriterionType(str, Enum):
    must_have = "must_have"
    weighted = "weighted"


class Criterion(BaseModel):
    name: str
    type: CriterionType
    weight: float = Field(0.0, ge=0.0, le=1.0)  # ignored for must_have
    evidence_guidance: str


class RubricSchema(BaseModel):
    criteria: list[Criterion] = Field(min_length=1)


class RoleBrief(BaseModel):
    title: str | None = None
    employment_type: Literal["full_time", "part_time", "casual"] | None = None
    hours_pattern: str | None = None
    location: str | None = None
    must_have_skills: list[str] = []
    nice_to_have_skills: list[str] = []
    experience_band: str | None = None


class IntakeDecision(BaseModel):
    action: Literal["ask", "finalize"]
    question: str | None = None
    brief: RoleBrief


class JDOutput(BaseModel):
    title: str
    jd_markdown: str
    rubric: RubricSchema


class WorkHistoryItem(BaseModel):
    role: str
    employer: str
    duration: str


class ParsedResume(BaseModel):
    work_history: list[WorkHistoryItem] = []
    skills: list[str] = []
    certifications: list[str] = []
    education: list[str] = []


class CriterionEval(BaseModel):
    """LLM output for ONE criterion. must_have -> met set; weighted -> score set."""

    met: bool | None = None
    score: int | None = Field(None, ge=0, le=5)
    evidence: str


class CriterionResult(BaseModel):
    criterion_name: str
    type: CriterionType
    met: bool | None = None
    score: int | None = None
    evidence: str


class ScoreRationale(BaseModel):
    rationale: str


class ScoreReportSchema(BaseModel):
    results: list[CriterionResult]
    overall: float  # weighted average on the 0-5 scale
    meets_all_must_haves: bool
    rationale: str


class KitQuestion(BaseModel):
    text: str
    category: Literal["behavioural", "candidate_specific", "practical"]
    listen_for: str
    criterion_name: str


class InterviewKitSchema(BaseModel):
    questions: list[KitQuestion] = Field(min_length=1)


class LintFlag(BaseModel):
    phrase: str
    risk: str
    suggested_rewrite: str
    citation: str | None = None


class LintResult(BaseModel):
    implemented: bool
    flags: list[LintFlag] = []


class FilterVerdict(BaseModel):
    implemented: bool
    allowed: bool = True
    reason: str | None = None
    compliant_rewrite: str | None = None
