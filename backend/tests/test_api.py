from shortlist.models.schemas import (
    Criterion, CriterionEval, CriterionType, IntakeDecision, InterviewKitSchema,
    JDOutput, KitQuestion, ParsedResume, RoleBrief, RubricSchema, ScoreRationale,
)

JD = JDOutput(
    title="Part-time Barista",
    jd_markdown="# Barista",
    rubric=RubricSchema(criteria=[
        Criterion(name="Right to work", type=CriterionType.must_have, evidence_guidance="g"),
        Criterion(name="Espresso skill", type=CriterionType.weighted, weight=1.0,
                  evidence_guidance="g"),
    ]),
)


def test_full_journey(api_client, fake_llm, tmp_path, monkeypatch):
    from shortlist.config import settings
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    # 1. create job - intake finalizes immediately, JD generated
    fake_llm.queue.append(IntakeDecision(action="finalize", brief=RoleBrief(title="Barista")))
    fake_llm.queue.append(JD)
    r = api_client.post("/api/jobs", json={"description": "part-time barista, weekends"})
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    r = api_client.get(f"/api/jobs/{job_id}")
    assert r.json()["status"] == "ready"
    assert len(r.json()["rubric"]) == 2

    # 2. seed 2 resumes (+1 corrupt) and screen
    r = api_client.post(f"/api/jobs/{job_id}/seed", json={"count": 2})
    assert r.json()["seeded"] == 3
    for _ in range(2):  # per parseable app: parse, 2 criterion evals, rationale
        fake_llm.queue.append(ParsedResume(skills=["espresso"]))
        fake_llm.queue.append(CriterionEval(met=True, evidence="e"))
        fake_llm.queue.append(CriterionEval(score=4, evidence="e"))
        fake_llm.queue.append(ScoreRationale(rationale="solid"))
    r = api_client.post(f"/api/jobs/{job_id}/screen")
    assert r.status_code == 200

    # 3. ranked list: 2 scored + 1 needs_manual_review (never dropped)
    rows = api_client.get(f"/api/jobs/{job_id}/applications").json()
    assert len(rows) == 3
    assert [x["status"] for x in rows[:2]] == ["scored", "scored"]
    assert rows[0]["overall"] == 4.0
    assert rows[2]["status"] == "needs_manual_review"

    # 4. human decision is recorded; invalid action rejected
    app_id = rows[0]["id"]
    r = api_client.post(f"/api/applications/{app_id}/decision",
                        json={"action": "shortlist", "note": "call Monday"})
    assert r.status_code == 200
    r = api_client.post(f"/api/applications/{app_id}/decision", json={"action": "auto_reject"})
    assert r.status_code == 422

    # 5. kit generation for the shortlisted candidate
    fake_llm.queue.append(InterviewKitSchema(questions=[
        KitQuestion(text="Walk me through opening the shop alone.", category="practical",
                    listen_for="process, safety", criterion_name="Espresso skill"),
    ]))
    r = api_client.post(f"/api/applications/{app_id}/kit")
    assert r.status_code == 200
    assert len(r.json()["questions"]) == 1

    # 6. detail view exposes raw + redacted + decision trail (identity revealed at review)
    detail = api_client.get(f"/api/applications/{app_id}").json()
    assert detail["raw_text"] and detail["redacted_text"]
    assert detail["decisions"][0]["action"] == "shortlist"


def test_screen_and_kit_require_rubric(api_client, fake_llm, tmp_path, monkeypatch):
    from shortlist.config import settings
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    # job stuck in intake - model asked a question, no JD/rubric generated yet
    fake_llm.queue.append(IntakeDecision(action="ask", question="What hours?", brief=RoleBrief()))
    r = api_client.post("/api/jobs", json={"description": "barista"})
    job_id = r.json()["job_id"]

    r = api_client.post(f"/api/jobs/{job_id}/screen")
    assert r.status_code == 409

    api_client.post(f"/api/jobs/{job_id}/seed", json={"count": 1})
    app_id = api_client.get(f"/api/jobs/{job_id}/applications").json()[0]["id"]
    r = api_client.post(f"/api/applications/{app_id}/kit")
    assert r.status_code == 409


def test_intake_rejected_after_finalize(api_client, fake_llm, tmp_path, monkeypatch):
    from shortlist.config import settings
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    fake_llm.queue.append(IntakeDecision(action="finalize", brief=RoleBrief(title="Barista")))
    fake_llm.queue.append(JD)
    r = api_client.post("/api/jobs", json={"description": "barista"})
    job_id = r.json()["job_id"]
    assert r.json()["decision"]["action"] == "finalize"

    r = api_client.post(f"/api/jobs/{job_id}/intake", json={"answer": "one more thing"})
    assert r.status_code == 409
