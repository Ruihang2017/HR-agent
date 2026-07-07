import json

from sqlalchemy.orm import Session

from shortlist.config import STAGE_MODELS
from shortlist.llm.client import call_structured
from shortlist.llm.prompts import get_prompt
from shortlist.models.schemas import (
    Criterion,
    CriterionEval,
    CriterionResult,
    CriterionType,
    ScoreRationale,
    ScoreReportSchema,
)
from shortlist.models.tables import Application, ScoreReport


def score_application(
    db: Session, application: Application, criteria: list[Criterion]
) -> ScoreReportSchema:
    """Score the REDACTED resume, one focused call per criterion (F3.2, F3.4)."""
    results: list[CriterionResult] = []
    for criterion in criteria:
        eval_ = call_structured(
            db,
            stage="score",
            prompt_name="score_criterion",
            variables={
                "criterion": criterion.model_dump_json(),
                "resume_text": application.redacted_text or "",
            },
            output_model=CriterionEval,
            job_id=application.job_id,
            application_id=application.id,
            cache_system=True,  # stable prefix cached across the whole screening run
        )
        results.append(
            CriterionResult(
                criterion_name=criterion.name,
                type=criterion.type,
                met=eval_.met,
                score=eval_.score,
                evidence=eval_.evidence,
            )
        )

    weighted = [
        (r, c) for r, c in zip(results, criteria) if c.type == CriterionType.weighted
    ]
    total_weight = sum(c.weight for _, c in weighted) or 1.0
    overall = round(sum((r.score or 0) * c.weight for r, c in weighted) / total_weight, 2)
    must_haves = [r for r in results if r.type == CriterionType.must_have]
    meets_all = all(bool(r.met) for r in must_haves)

    rationale = call_structured(
        db,
        stage="score",
        prompt_name="score_rationale",
        variables={"results": json.dumps([r.model_dump() for r in results])},
        output_model=ScoreRationale,
        job_id=application.job_id,
        application_id=application.id,
    ).rationale

    report = ScoreReportSchema(
        results=results, overall=overall, meets_all_must_haves=meets_all, rationale=rationale
    )
    db.add(
        ScoreReport(
            application_id=application.id,
            report=report.model_dump(),
            overall=overall,
            model=STAGE_MODELS["score"],
            prompt_version=get_prompt("score_criterion").version,
        )
    )
    application.status = "scored"
    db.commit()
    return report
