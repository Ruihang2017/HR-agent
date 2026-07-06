from typing import TypeVar

from anthropic import Anthropic
from pydantic import BaseModel
from sqlalchemy.orm import Session

from shortlist.config import STAGE_MODELS
from shortlist.llm.prompts import get_prompt
from shortlist.models.tables import AuditEvent

T = TypeVar("T", bound=BaseModel)

_client: Anthropic | None = None


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic()
    return _client


class LLMCallError(Exception):
    pass


def call_structured(
    db: Session,
    *,
    stage: str,
    prompt_name: str,
    variables: dict,
    output_model: type[T],
    job_id: int | None = None,
    application_id: int | None = None,
    cache_system: bool = False,
) -> T:
    """The only Anthropic call site. Structured output, one retry, audit trail."""
    prompt = get_prompt(prompt_name)
    model = STAGE_MODELS[stage]
    system_block: dict = {"type": "text", "text": prompt.system}
    if cache_system:
        # stable prefix (system + rubric baked into it) -> cache hits across a scoring run
        system_block["cache_control"] = {"type": "ephemeral"}
    user_text = prompt.user_template.format(**variables)

    last_error: Exception | None = None
    for _attempt in range(2):
        try:
            response = _get_client().messages.parse(
                model=model,
                max_tokens=8000,
                system=[system_block],
                messages=[{"role": "user", "content": user_text}],
                output_format=output_model,
            )
            parsed = response.parsed_output
            if parsed is None:
                raise LLMCallError(f"{stage}: response had no parsed output")
            db.add(
                AuditEvent(
                    job_id=job_id,
                    application_id=application_id,
                    kind="model_call",
                    stage=stage,
                    model=model,
                    prompt_name=prompt_name,
                    prompt_version=prompt.version,
                    payload={
                        "variables": {k: str(v)[:2000] for k, v in variables.items()},
                        "output": parsed.model_dump(),
                    },
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                )
            )
            db.commit()
            return parsed
        except Exception as e:  # noqa: BLE001 - one retry, then flagged for manual review upstream
            last_error = e
    db.add(
        AuditEvent(
            job_id=job_id,
            application_id=application_id,
            kind="model_call_failed",
            stage=stage,
            model=model,
            prompt_name=prompt_name,
            prompt_version=prompt.version,
            payload={"error": str(last_error)},
        )
    )
    db.commit()
    raise LLMCallError(f"{stage} failed after retry: {last_error}") from last_error
