from typing import TypeVar

from openai import OpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from shortlist.config import STAGE_MODELS, settings
from shortlist.llm.prompts import get_prompt
from shortlist.models.tables import AuditEvent

T = TypeVar("T", bound=BaseModel)

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        # api_key comes from backend/.env via settings; None lets the SDK fall back
        # to the OPENAI_API_KEY environment variable.
        _client = OpenAI(api_key=settings.openai_api_key)
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
    """The only OpenAI call site. Structured output, one retry, audit trail.

    `cache_system` is kept for call-site compatibility and intent: OpenAI caches long,
    stable prompt prefixes automatically (no cache_control needed), so we simply keep the
    system prompt first and byte-identical across a scoring run to earn those hits.

    We pass no temperature/top_p: scoring consistency (F3.4) comes from per-criterion
    calls, strict schemas, and frozen versioned prompts — and omitting sampling params
    keeps the wrapper portable across model families (incl. reasoning models).
    """
    prompt = get_prompt(prompt_name)
    model = STAGE_MODELS[stage]
    user_text = prompt.user_template.format(**variables)
    # System prompt first (stable prefix -> OpenAI automatic prompt caching), then the
    # per-candidate user content. Resume text stays inside the user message, never system.
    messages = [
        {"role": "system", "content": prompt.system},
        {"role": "user", "content": user_text},
    ]

    last_error: Exception | None = None
    for _attempt in range(2):
        try:
            response = _get_client().beta.chat.completions.parse(
                model=model,
                max_completion_tokens=8000,
                messages=messages,
                response_format=output_model,
            )
            parsed = response.choices[0].message.parsed
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
                    input_tokens=response.usage.prompt_tokens,
                    output_tokens=response.usage.completion_tokens,
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
