import re

from shortlist.models.schemas import FilterVerdict, LintResult

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"(?:\+?61|0)[\s-]?[2-478](?:[\s-]?\d){8}")
YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
DOB_LINE = re.compile(r"^.*\b(date of birth|dob|born)\b.*$", re.IGNORECASE | re.MULTILINE)


class RegexRedactor:
    """Phase 1 stub: regex only. Phase 2 layers NER + a Haiku pass behind the same interface."""

    def redact(self, text: str, known_names: list[str]) -> str:
        redacted = DOB_LINE.sub("[DOB REDACTED]", text)
        redacted = EMAIL.sub("[EMAIL]", redacted)
        redacted = PHONE.sub("[PHONE]", redacted)
        redacted = YEAR.sub("[YEAR]", redacted)
        for name in known_names:
            for part in name.split():
                if len(part) > 1:
                    redacted = re.sub(re.escape(part), "[NAME]", redacted, flags=re.IGNORECASE)
        return redacted


class PassthroughLinter:
    """Phase 1 stub: honest no-op. implemented=False so the UI can label it."""

    def lint(self, jd_markdown: str, raw_inputs: str) -> LintResult:
        return LintResult(implemented=False, flags=[])


class PassthroughQuestionFilter:
    """Phase 1 stub: honest no-op. implemented=False so the UI can label it."""

    def check(self, question: str) -> FilterVerdict:
        return FilterVerdict(implemented=False, allowed=True)
