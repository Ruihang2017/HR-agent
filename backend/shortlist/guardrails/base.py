from typing import Protocol

from shortlist.models.schemas import FilterVerdict, LintResult


class Redactor(Protocol):
    def redact(self, text: str, known_names: list[str]) -> str: ...


class JDLinter(Protocol):
    def lint(self, jd_markdown: str, raw_inputs: str) -> LintResult: ...


class QuestionFilter(Protocol):
    def check(self, question: str) -> FilterVerdict: ...


# Phase 2 swaps these factory returns for real implementations. Stages call ONLY these.
def get_redactor() -> Redactor:
    from shortlist.guardrails.stubs import RegexRedactor

    return RegexRedactor()


def get_linter() -> JDLinter:
    from shortlist.guardrails.stubs import PassthroughLinter

    return PassthroughLinter()


def get_question_filter() -> QuestionFilter:
    from shortlist.guardrails.stubs import PassthroughQuestionFilter

    return PassthroughQuestionFilter()
