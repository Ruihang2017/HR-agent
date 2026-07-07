from shortlist.models.tables import Application, Job
from shortlist.seeds import generate_resumes, seed_applications


def test_generation_is_deterministic(tmp_path):
    a = generate_resumes(tmp_path / "a", count=5, seed=7)
    b = generate_resumes(tmp_path / "b", count=5, seed=7)
    assert len(a) == 6  # 5 resumes + 1 corrupt pdf
    assert (tmp_path / "a" / "resume_00.txt").read_text(encoding="utf-8") == \
           (tmp_path / "b" / "resume_00.txt").read_text(encoding="utf-8")


def test_seed_applications_flags_corrupt_files(db, tmp_path):
    job = Job(description_raw="barista", status="ready")
    db.add(job)
    db.commit()
    resume_dir = tmp_path / "resumes"
    generate_resumes(resume_dir, count=4, seed=7)

    n = seed_applications(db, job.id, resume_dir)

    assert n == 5
    apps = db.query(Application).filter_by(job_id=job.id).all()
    manual = [a for a in apps if a.status == "needs_manual_review"]
    received = [a for a in apps if a.status == "received"]
    assert len(manual) == 1  # the corrupt pdf, flagged not dropped
    assert len(received) == 4
    assert all(a.raw_text for a in received)
    assert received[0].candidate_name  # first line of the resume


def test_whitespace_only_resume_flagged_not_dropped(db, tmp_path):
    job = Job(description_raw="barista", status="ready")
    db.add(job)
    db.commit()
    resume_dir = tmp_path / "resumes"
    resume_dir.mkdir()
    (resume_dir / "resume_blank.txt").write_text("   \n\n  \n", encoding="utf-8")

    n = seed_applications(db, job.id, resume_dir)

    assert n == 1
    app = db.query(Application).filter_by(job_id=job.id).one()
    assert app.status == "needs_manual_review"
    assert app.candidate_name == "resume_blank"
