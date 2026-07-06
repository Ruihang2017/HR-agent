from shortlist.guardrails.base import get_linter, get_question_filter, get_redactor

RESUME = """Alex Chen
Email: alex.chen@example.com | Phone: 0412 345 678
Date of Birth: 12/03/1998

EXPERIENCE
Barista, Beans & Co, 2019-2023
"""


def test_regex_redactor_strips_identity_signals():
    redacted = get_redactor().redact(RESUME, known_names=["Alex Chen"])
    assert "alex.chen@example.com" not in redacted
    assert "0412 345 678" not in redacted
    assert "Alex" not in redacted and "Chen" not in redacted
    assert "1998" not in redacted and "2019" not in redacted
    assert "[EMAIL]" in redacted and "[NAME]" in redacted


def test_passthrough_linter_flags_nothing_and_says_so():
    result = get_linter().lint("# Barista wanted\nyoung and energetic", raw_inputs="")
    assert result.implemented is False
    assert result.flags == []


def test_passthrough_question_filter_allows_and_says_so():
    verdict = get_question_filter().check("Are you an Australian citizen?")
    assert verdict.implemented is False
    assert verdict.allowed is True
