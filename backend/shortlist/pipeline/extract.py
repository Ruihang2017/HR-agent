from dataclasses import dataclass
from pathlib import Path


@dataclass
class ExtractResult:
    text: str | None
    error: str | None = None


def extract_text(path: Path) -> ExtractResult:
    """File -> text. Never raises: failures become errors so the candidate is
    flagged 'needs manual review', never silently dropped (PRD F2.2)."""
    try:
        suffix = path.suffix.lower()
        if suffix == ".txt":
            return ExtractResult(text=path.read_text(encoding="utf-8"))
        if suffix == ".docx":
            import docx

            doc = docx.Document(str(path))
            return ExtractResult(text="\n".join(p.text for p in doc.paragraphs))
        if suffix == ".pdf":
            import pdfplumber

            with pdfplumber.open(path) as pdf:
                text = "\n".join((page.extract_text() or "") for page in pdf.pages)
            if not text.strip():
                return ExtractResult(text=None, error="empty PDF text (scanned document?)")
            return ExtractResult(text=text)
        return ExtractResult(text=None, error=f"unsupported file type: {suffix}")
    except Exception as e:  # noqa: BLE001 - extraction failure = manual review, never a crash
        return ExtractResult(text=None, error=f"extraction failed: {e}")
