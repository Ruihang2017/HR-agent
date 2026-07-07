import random
from pathlib import Path

from sqlalchemy.orm import Session

from shortlist.models.tables import Application
from shortlist.pipeline.extract import extract_text

FIRST_NAMES = ["Alex", "Sam", "Jordan", "Priya", "Wei", "Aisha",
               "Liam", "Sofia", "Noah", "Grace", "Marco", "Fatima"]
LAST_NAMES = ["Chen", "Nguyen", "Smith", "Patel", "Kaur", "Okafor",
              "Rossi", "Jones", "Garcia", "Kim", "Brown", "Ali"]
ROLES = ["Barista", "Cafe All-rounder", "Waitstaff", "Kitchen Hand"]
EMPLOYERS = ["Beans & Co", "The Daily Grind", "Cafe Aroma",
             "Brew Bros", "Corner Espresso", "Morning Star Cafe"]
SKILL_POOL = ["espresso machine operation", "milk texturing", "POS handling",
              "cash reconciliation", "food safety certificate", "opening/closing procedures",
              "customer service", "barista training", "stock ordering", "latte art"]
EDUCATION = ["Year 12 Certificate", "Certificate III in Hospitality", "High school", ""]

TEMPLATE = """{name}
Email: {email} | Phone: {phone}

EXPERIENCE
{experience}

SKILLS
{skills}

EDUCATION
{education}
"""


def generate_resumes(out_dir: Path, count: int = 50, seed: int = 7) -> list[Path]:
    """Deterministic synthetic resumes of varied quality, plus one corrupt file (F2.3)."""
    rng = random.Random(seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for i in range(count):
        first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
        years = rng.randint(0, 8)
        n_jobs = max(1, min(3, years // 2 + rng.randint(0, 1)))
        experience = "\n".join(
            f"- {rng.choice(ROLES)}, {rng.choice(EMPLOYERS)}, "
            f"{rng.randint(1, max(1, years))} year(s)"
            for _ in range(n_jobs)
        )
        skills = "\n".join(f"- {s}" for s in rng.sample(SKILL_POOL, rng.randint(1, 6)))
        text = TEMPLATE.format(
            name=f"{first} {last}",
            email=f"{first}.{last}@example.com".lower(),
            phone=f"04{rng.randint(10_000_000, 99_999_999)}",
            experience=experience,
            skills=skills,
            education=rng.choice(EDUCATION),
        )
        path = out_dir / f"resume_{i:02}.txt"
        path.write_text(text, encoding="utf-8")
        paths.append(path)
    corrupt = out_dir / "resume_corrupt.pdf"
    corrupt.write_bytes(b"%PDF-1.4 not actually a pdf")
    paths.append(corrupt)
    return paths


def seed_applications(db: Session, job_id: int, resume_dir: Path) -> int:
    """One Application per resume file; unextractable files flagged, never dropped."""
    count = 0
    for path in sorted(resume_dir.glob("resume_*")):
        result = extract_text(path)
        if result.text:
            lines = [ln for ln in result.text.strip().splitlines() if ln.strip()]
            name, status = lines[0].strip(), "received"
        else:
            name, status = path.stem, "needs_manual_review"
        db.add(Application(job_id=job_id, candidate_name=name, email="",
                           file_path=str(path), raw_text=result.text, status=status))
        count += 1
    db.commit()
    return count
