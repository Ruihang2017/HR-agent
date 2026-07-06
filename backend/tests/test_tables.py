from shortlist.models.tables import Application, AuditEvent, Job, Rubric


def test_job_rubric_application_roundtrip(db):
    job = Job(description_raw="need a barista", status="intake")
    db.add(job)
    db.commit()
    db.add(Rubric(job_id=job.id, criteria=[{"name": "coffee", "type": "weighted"}], version=1))
    db.add(Application(job_id=job.id, candidate_name="Alex Chen", email="a@x.com", status="received"))
    db.add(AuditEvent(job_id=job.id, kind="model_call", stage="intake", payload={"ok": True}))
    db.commit()

    loaded = db.get(Job, job.id)
    assert loaded.status == "intake"
    assert loaded.intake_history == []
    rubric = db.query(Rubric).filter_by(job_id=job.id).one()
    assert rubric.criteria[0]["name"] == "coffee"
    audit = db.query(AuditEvent).one()
    assert audit.payload == {"ok": True}
