# PRD — Shortlist: AI Hiring Assistant for Australian Small Business

| | |
|---|---|
| **Working name** | Shortlist |
| **Version** | 1.0 — Canonical |
| **Date** | 9 July 2026 |
| **Owner** | Horace Hou |
| **Status** | Practice / portfolio project heading toward a client demo and possible pilot — not a commercial product |

**Version history**
| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-06 | Original draft PRD |
| 0.1+ | 2026-07-09 | Stack decision + OpenAI model tiering noted in §7/§11 |
| 1.0 | 2026-07-09 | Full rewrite as the self-contained single source of truth: current state, architecture, decisions log, phased plan, cross-cutting concerns, glossary. Verified against the codebase. |

## How to use this document

- This PRD is the **source of truth** for the project (see `CLAUDE.md`, the repo working agreement). Do not modify it unless the user explicitly asks; if code and PRD disagree, raise the conflict rather than silently editing either.
- **Stable identifiers used throughout:** functional requirements are `F<area>.<n>` (e.g. F3.3), decisions are `D-<n>` (§11), phase workstreams are `WS-<phase>.<n>` (§12), open questions are `OQ-<n>` (§14). Other repo documents reference these — keep them stable.
- **Section-numbering compatibility:** §1–§8 keep the same topics and numbers as PRD v0.1, because code comments and docs across the repo cite them (e.g. "PRD §8" in `docs/superpowers/plans/`, F-numbers in `backend/` docstrings). From §9 onward the structure is new in v1.0: old §9 *Milestones* is superseded by §12, old §10 *Risks* by §12.1, old §11 *Open questions* by §14.
- Companion documents: `DECISIONS.md` (running decision log; §11 summarises it), `docs/handover/` (per-phase handovers), `docs/superpowers/specs/2026-07-06-shortlist-poc-design.md` (original approved design — note it predates the OpenAI migration, see D-8), `docs/superpowers/plans/` (Phase 1 detailed plan + phased roadmap).
- Statuses used in §5–§7: **[Implemented]** working and tested today; **[Stub]** present behind a stable interface but deliberately inert, labelled as such in the UI; **[Planned — WS-x.y]** scheduled in §12; **[Unscheduled — OQ-n]** required by this PRD but not yet scheduled — resolution tracked in §14.

---

## 1. Overview

### Problem

Small Australian businesses (roughly 1–20 employees) hire infrequently and have no HR function. When they do hire, the owner writes the job ad from scratch, wades through resumes manually, improvises interview questions, and — often without realising it — risks breaching anti-discrimination law in the ad wording or the interview itself.

### Product

An AI agent that takes a business owner from "I need to hire someone" to "I'm sitting down to interview my top three candidates, with a prepared question set," while enforcing fairness and legal guardrails at every step where an AI hiring tool could otherwise cause harm.

Concretely: a plain-language role description goes in; a bounded intake Q&A fills the gaps; the system generates a job description and a structured scoring rubric; incoming resumes are parsed, **identity-redacted**, and scored per-criterion against the rubric with quoted evidence; the owner reviews a ranked, identity-blind shortlist and makes every accept/hold/reject decision personally; for each shortlisted candidate the system generates a tailored interview kit with an unlawful-question filter. Every AI output and every human decision lands in an append-only audit trail.

### Framing

This is a skills-practice / portfolio project. The market already contains well-funded incumbents (Employment Hero's Recruitment Agent, FairWork Mate, Sapia.ai). The goal is not to beat them; it is to build a complete, defensible agent pipeline that demonstrates sound engineering judgment — particularly around bias mitigation, human-in-the-loop design, and grounded (non-hallucinated) compliance guidance. It is heading toward a 15-minute client demo and a possible small pilot.

## 2. Goals & success criteria

1. **A working end-to-end demo:** JD in → ranked shortlist + interview kit out, on a batch of synthetic (later, real) resumes. *(Achieved in Phase 1 — see §9.)*
2. **Every stage produces structured, inspectable output** (rubrics, scores, rationales, audit events) — no opaque "the AI decided" steps. *(Achieved — every model call is a Pydantic-validated structured output persisted as an `AuditEvent`.)*
3. **Demonstrable bias mitigation:** identity-blind screening that can be shown side-by-side against naive screening, backed by a matched-pair bias harness. *(Phase 2 — WS-2.5; the demo comparison is WS-3.1.)*
4. **Demonstrable compliance guardrails:** discriminatory-language linting on JDs, an unlawful-question filter on interview kits, and a human decision gate before any candidate outcome. *(Decision gate achieved; linter and filter are Phase 2 — WS-2.2, WS-2.4.)*
5. **Portfolio quality:** clean architecture and documentation good enough to serve as a portfolio piece for AI engineering roles. *(Phase 3 — WS-3.3.)*

**The demo definition of done** (Phase 3): the full journey runs from a clean database in under 15 minutes, includes one live naive-vs-blind comparison, one linter catch, and one blocked interview question, and the repo reads as a portfolio piece.

## 3. Non-goals

Load-bearing scope boundaries. These protect the project from becoming a worse version of existing products:

- **Candidate sourcing / search.** No integration with Seek, LinkedIn, or Indeed candidate pools — that data sits behind enterprise partnerships. Scope is inbound applications only.
- **Award interpretation engine.** No computing pay rates, classifications, penalty rates, or entitlements across the 122 modern awards. The system may surface a pointer ("this role likely falls under the General Retail Industry Award — check fairwork.gov.au") but never calculates or asserts rates.
- **Payroll, onboarding, contracts, or Employer-of-Record functions.**
- **Legal advice.** All compliance output is labelled general information. The system cites its sources (NES, FWO/AHRC guidance) and directs users to the Fair Work Ombudsman or a professional for decisions.
- **Automated hiring decisions.** The system never rejects, ranks-out, or advances a candidate without an explicit human action. This is a hard product constraint enforced in code today, not a v2 nicety (see F3.3/F4.2, §13.4).
- **Multi-tenant SaaS hardening.** Single-tenant demo quality is acceptable; production differences are documented rather than built (see WS-3.6 pilot gap register).

## 4. Target users

**Primary persona — "Sam," owner-operator.** Runs a 6-person business (café, trade services, small agency). Hires maybe twice a year. No HR training. Time-poor; does admin at night. Doesn't know what a "position description rubric" is and doesn't want to. Vaguely anxious about "getting sued" but has never read the Fair Work website. Sam is the only user of the current UI.

**Secondary user — the candidate**, who would interact only with a simple application form. *(No candidate-facing surface exists today; applications enter via the synthetic seeder. See F2.1 and OQ-1.)*

## 5. End-to-end user journey

The target journey, annotated with today's reality:

1. Sam describes the role in plain language ("I need a part-time barista, weekends, must be able to open the shop alone"). **[Implemented]** — `frontend/src/pages/NewJobPage.tsx` → `POST /api/jobs`.
2. The agent interviews Sam briefly to fill gaps (max 5 questions, code-enforced), then generates a job description **and** a structured scoring rubric. It flags risky wording before it reaches the ad. **[Intake + JD/rubric implemented; the wording linter is a Stub — the UI banner says so]**.
3. Sam posts the JD wherever they like. Candidates apply via a hosted form (upload resume, short questions). **[Unscheduled — OQ-1]** — today, applications are created only by the synthetic-resume seeder (`POST /api/jobs/{id}/seed`).
4. The agent parses each resume, produces a redacted (identity-blind) version, and scores it against the rubric with a written rationale. **[Implemented; redaction is the regex Stub until WS-2.3]**.
5. Sam opens the review screen: ranked shortlist, scores, rationales, and the full original resume one click away. Identity is revealed only here. Sam decides who to interview; every decision is Sam's click, and every click is logged. **[Implemented]** — `frontend/src/pages/JobDetailPage.tsx`, `CandidatePage.tsx`.
6. For each candidate Sam selects, the agent generates a tailored interview kit: role-specific and resume-specific questions, plus a what-not-to-ask panel. Any question Sam adds manually is checked against the unlawful-question filter. **[Kit generation implemented; the filter is a Stub; manual-question entry has no API/UI yet — both WS-2.4]**.

## 6. Functional requirements

Each requirement carries its current status and, where reality diverges from the requirement, an explicit divergence note.

### F1 — Job description generator

- **F1.1 Conversational intake.** The agent asks targeted follow-up questions until it has role title, employment type (full-time / part-time / casual), hours pattern, location, must-have skills, nice-to-have skills, and experience band. Max ~5 questions; sensible defaults otherwise. The cap is enforced **in code**, not prompts.
  **[Implemented]** — `backend/shortlist/pipeline/intake.py` (`intake_step`); brief schema `RoleBrief` in `backend/shortlist/models/schemas.py`; cap `settings.max_intake_questions` (5) in `backend/shortlist/config.py`. *Known gap: when code overrides the model's "ask" into "finalize" at the cap, no dedicated audit event records the override (WS-2.12).*
- **F1.2 Output A — the JD.** Plain-language job ad with structured sections (about the role, responsibilities, requirements, how to apply).
  **[Implemented]** — `backend/shortlist/pipeline/jd_gen.py` (`generate_jd`), prompt `jd_gen` in `backend/shortlist/llm/prompts.py`. **Divergence:** v0.1 required a configurable tone (friendly / professional); the implementation hardcodes a friendly tone in the prompt. Whether tone configurability is worth building is OQ-6.
- **F1.3 Output B — the scoring rubric** (the contract for all downstream stages): weighted criteria, each with a name, weight, type (`must_have` | `weighted`), and evidence guidance ("what would count as meeting this"). Must-haves are pass/fail; weighted criteria score 0–5.
  **[Implemented]** — `RubricSchema`/`Criterion` in `schemas.py`; persisted as a `Rubric` row (JSON criteria, versioned). The prompt asks for 2–4 must-haves and 3–5 weighted criteria with weights summing to ~1.0; scoring normalises by the actual weight sum (`backend/shortlist/pipeline/score.py`), so imperfect sums don't corrupt the 0–5 scale.
- **F1.4 Discrimination linter.** Before the JD is finalised, scan Sam's inputs and the draft for language risking direct or indirect discrimination — age-coded terms ("recent graduate," "digital native," "young and energetic"), gendered wording, unnecessary physical requirements, citizenship demands where work rights suffice. Each flag shows the phrase, the risk, and a suggested rewrite with a grounding citation. Sam can accept or dismiss; dismissals are logged.
  **[Stub — Planned WS-2.2]** — `PassthroughLinter` in `backend/shortlist/guardrails/stubs.py` returns `implemented=False, flags=[]`; the lint slot is wired into `generate_jd` and the UI shows an amber "stub (Phase 2)" banner (`JobDetailPage.tsx`). The accept/dismiss flow does not exist yet.
- **F1.5 Award pointer (informational only).** Suggest the likely applicable modern award **by name** with a link to fairwork.gov.au, wrapped in the standard general-information disclaimer. No rates, no classifications, ever.
  **[Planned — WS-2.11]** — nothing exists today.

### F2 — Application intake & resume parsing

- **F2.1 Hosted application form per job:** name, contact, work-rights self-declaration (yes/no, no visa detail requested), resume upload (PDF/DOCX), and up to 3 short screening questions derived from the rubric's must-haves.
  **[Unscheduled — OQ-1]** — no candidate-facing surface, no upload endpoint, no work-rights declaration field exists. The `Application` table (`backend/shortlist/models/tables.py`) can hold candidate name/email/file path, but rows are created only by the seeder. The demo deliberately runs on seeded data (D-6); whether the form must exist before a pilot is OQ-1.
- **F2.2 Resume parsing to a structured schema:** work history (role, employer, duration), skills, certifications/licences, education. Parsing failures degrade gracefully — raw text is retained and the candidate is flagged for manual review, never silently dropped.
  **[Implemented]** — text extraction in `backend/shortlist/pipeline/extract.py` (txt/docx/pdf; **never raises** — failures return an error so callers flag `needs_manual_review`); LLM parse in `backend/shortlist/pipeline/parse.py` → `ParsedResume`. Scanned/empty PDFs are flagged for manual review; the design spec's model-native-PDF fallback was **not** built (OQ-5).
- **F2.3 Demo-mode seeder:** a script that loads a batch of synthetic resumes (varied quality, varied formats) so the pipeline can be exercised without live applicants.
  **[Implemented, with divergence]** — `backend/shortlist/seeds.py`: deterministic (seeded RNG), default 50 resumes of varied quality plus one deliberately corrupt PDF to exercise the manual-review path. **Divergence:** "varied formats" is not met — all generated resumes are `.txt`; the only non-txt file is the corrupt PDF. *Known defect: `seed_applications` globs every `resume_*` file in `data/synthetic/`, so seeding with a smaller count after a larger run re-ingests stale files (WS-2.12).*

### F3 — Identity-blind screening & scoring

- **F3.1 Redaction pass** (deterministic where possible, model-assisted where not): before scoring, strip or mask name, pronouns/gendered terms, age and date of birth, graduation years, photo, suburb/address, nationality/ethnicity signals, and club/association memberships that proxy for protected attributes. The redacted document is what the scoring model sees.
  **[Stub — Planned WS-2.3]** — `RegexRedactor` (`guardrails/stubs.py`) masks emails, AU phone numbers, years (19xx/20xx), DOB lines, and the candidate's known name. Pronouns, suburbs, nationality signals, club memberships, and photos are **not** yet handled. The invariant that scoring sees only `redacted_text` **is** enforced (`pipeline/score.py`, `pipeline/redact.py`).
- **F3.2 Scoring.** Evaluate the redacted resume against each rubric criterion — one focused model call per criterion, never one holistic call. Output per criterion: met/not-met (must-haves) or 0–5 (weighted), plus a 1–2-sentence evidence citation quoting the resume. Output overall: weighted average on the 0–5 scale plus a short plain-language rationale.
  **[Implemented]** — `backend/shortlist/pipeline/score.py` (`score_application`); prompts `score_criterion`, `score_rationale`; persisted as `ScoreReport` with model + prompt version.
- **F3.3 Must-have failures do not auto-reject.** They place the candidate in a "did not meet stated requirements" section of the review screen — visible, one click from full detail. Only Sam moves anyone to rejected.
  **[Implemented]** — `JobDetailPage.tsx` renders the separate section ("your call, never auto-rejected"); no code path sets a rejected status without a human `POST /api/applications/{id}/decision`.
- **F3.4 Consistency requirement.** Scoring the same resume against the same rubric twice must produce the same must-have outcomes and weighted scores within ±0.5. Achieved via per-criterion calls, strict output schemas, and frozen versioned prompts — **not** via sampling parameters; the LLM wrapper sends no `temperature`/`top_p` (D-8). A golden-set regression test enforces this property.
  **[Mechanisms implemented; regression test Planned — WS-2.6]**. *(v0.1 said "low temperature"; that wording is superseded — see D-8.)*
- **F3.5 Bias check harness (portfolio centrepiece).** A test suite that runs matched resume pairs — identical content, different names/genders/ages — through the full pipeline and asserts score parity. The harness and its results report ship in the repo.
  **[Planned — WS-2.5]** — nothing exists today.

### F4 — Ranked shortlist & owner review

- **F4.1 Review screen.** Candidates ranked by score; each row shows score, rationale, status; candidate detail shows the rubric breakdown with per-criterion evidence and both the redacted and original resume (redacted shown by default; identity revealed only at this human-review stage).
  **[Implemented]** — `JobDetailPage.tsx` (ranked list, sorted score-desc with unscored last), `CandidatePage.tsx` (report table, redacted/original toggle). Candidates flagged `needs_manual_review` appear in the main list with a "—" score and their status label — never dropped.
- **F4.2 Owner actions per candidate:** shortlist for interview, hold, reject — each optionally with a note. **There is no bulk auto-action and no system-initiated rejection.**
  **[Implemented]** — `POST /api/applications/{id}/decision` (`backend/shortlist/app/routers/applications.py`) accepts exactly `shortlist|hold|reject` (422 otherwise) and writes both a `DecisionEvent` and an `AuditEvent`. No bulk endpoint exists.
- **F4.3 Audit log.** Every AI output (rubric, scores, flags) and every human action (with timestamp and note) is persisted per job. Exportable as a single JSON record (PDF is a stretch goal, OQ-9).
  **[Logging implemented; export Planned — WS-2.8]** — `AuditEvent` rows are written by the LLM wrapper and the decision endpoint. There is **no read or export API for audit events yet**; today they are inspectable only in the SQLite DB.
- **F4.4 Nudge, don't block.** If Sam rejects a top-scored candidate or shortlists a bottom-scored one, the UI asks for an optional reason. It never prevents the action — the human is the decision-maker, full stop.
  **[Planned — WS-2.7]** — not built.

### F5 — Interview kit generator

- **F5.1 Kit contents.** Per shortlisted candidate: 8–12 questions grouped as role-based behavioural questions (from the rubric), candidate-specific probes (from gaps or notable items in their actual resume), and practical/scenario questions where the role suits it.
  **[Implemented]** — `backend/shortlist/pipeline/kit_gen.py` (`generate_kit`), prompt `kit_gen`, categories enforced by `KitQuestion.category`. The kit prompt receives the **redacted** resume.
- **F5.2 Listen-fors.** Each question carries a "listen for" note tied to a rubric criterion, so Sam can take structured notes.
  **[Implemented]** — `KitQuestion.listen_for` + `criterion_name`; rendered in `CandidatePage.tsx`.
- **F5.3 Unlawful-question filter.** Every generated question, and every question Sam writes into the kit manually, is checked against the prohibited categories (age, marital/family status, pregnancy or family plans, religion, national origin/ethnicity, disability or health matters not directly relevant to inherent role requirements, union membership, sexual orientation). Blocked questions show the reason and, where a lawful underlying concern exists, a compliant rewrite ("Are you an Australian citizen?" → "Do you have the right to work in Australia?").
  **[Stub — Planned WS-2.4]** — `PassthroughQuestionFilter` allows everything with `implemented=False`; verdicts are persisted per question in `InterviewKit.filter_results`. `check_manual_question` exists in `kit_gen.py` **but no API route or UI exposes manual question entry** — that surface is part of WS-2.4. *Known latent defect: if a real filter blocks every question, `generate_kit` raises `ValidationError` (`InterviewKitSchema` requires ≥1 question) before persisting anything — semantics to be decided in WS-2.4 (OQ-7).*
- **F5.4 Printable one-pager per candidate:** questions, listen-fors, and a short "don't ask" reminder panel.
  **[Unscheduled — OQ-3]** — the kit renders in-app only.

### F6 — Compliance layer (cross-cutting)

- **F6.1 Grounding corpus.** A small curated RAG store containing the NES summary, FWO and AHRC guidance on discrimination in recruitment and unlawful interview questions, and the FWO's guidance on job ads. Every compliance-flavoured output (linter flags, filter blocks, award pointers) must cite which corpus document it draws from. If the corpus doesn't cover a question, the system says so and links to fairwork.gov.au rather than improvising.
  **[Planned — WS-2.1]** — nothing exists today; this is the foundation for WS-2.2, WS-2.4, and WS-2.11.
- **F6.2 Disclaimer policy.** All compliance outputs carry a consistent "general information, not legal advice" label with a link to the Fair Work Ombudsman (13 13 94 / fairwork.gov.au).
  **[Planned — WS-2.11]** — no disclaimer component exists (acceptable today only because no compliance-flavoured output is live; the stubs are inert).
- **F6.3 Alignment with regulator expectations.** The design assumes Fair Work's position that AI may assist but not solely determine hiring decisions — hence F3.3, F4.2, and F4.3 are treated as **invariants, not features**, in every phase.
  **[Implemented as invariants]** — see §13.4.

## 7. Non-functional requirements

- **Privacy.** Resumes are personal information. Even where a small business is exempt from parts of the Privacy Act, the system behaves as if it isn't: candidate data stored encrypted at rest, retained per-job with a configurable window (default 6 months post-close), deletable on request via a single action, and never used to train anything. The application form states what happens to the data.
  **[Planned — WS-2.10]** — today resume files sit unencrypted under `data/synthetic/`, and no retention/deletion mechanism exists. Mitigated for now by the synthetic-data-only rule (§13.5): no real PII is in the system. The form statement depends on OQ-1.
- **Auditability.** Every model call that affects a candidate outcome logs its inputs (redacted/truncated), outputs, model, and prompt version. Reproducibility of a decision trail matters more than latency.
  **[Implemented]** — `call_structured` in `backend/shortlist/llm/client.py` writes an `AuditEvent` for every call (success and failure), including token usage; inputs are truncated to 2,000 chars per variable.
- **Determinism where it counts.** Redaction rules and the unlawful-question category list are code/config, not model vibes. The model interprets; the rules decide. Code — never the model — controls pipeline flow and the intake question cap.
  **[Implemented as an architecture invariant]** — see §10.2 and D-2.
- **Cost envelope.** Cheap default model on parsing/redaction and a stronger model on scoring and generation — implemented on OpenAI as `gpt-4o-mini` (parse/redact) and `gpt-4o` (intake, JD/rubric, scoring, kits, guardrail reasoning), per-stage in `backend/shortlist/config.py` (`STAGE_MODELS`). A 50-resume screening run should cost cents, not dollars.
  **[Implemented; cost claim unverified]** — no live-run cost measurement has been taken (WS-2.0). OpenAI's automatic prompt-prefix caching is relied on for scoring runs (stable system prompt first; see §13.3).
- **Honesty in failure.** Parsing or scoring failures surface as `needs_manual_review`, never as a silent zero score or a dropped candidate.
  **[Implemented]** — enforced in `extract.py`, `parse.py`, and the per-candidate error isolation in `backend/shortlist/pipeline/run.py`.

## 8. Data model

Sketch (unchanged since v0.1, now implemented): `Job` → has one current `Rubric` → has many `Application` → each has one `ScoreReport` and many `DecisionEvent`; `Application` has `InterviewKit`s; `AuditEvent` is the append-only union of all model outputs and decision events.

Implementation: SQLAlchemy 2.0 ORM in `backend/shortlist/models/tables.py`, SQLite database at `backend/shortlist.db` (created on app startup by `init_db()` in `backend/shortlist/db.py`; gitignored). Resume files live on disk (`data/synthetic/`), referenced by path.

| Table | Key columns | Notes |
|---|---|---|
| `jobs` | `title`, `description_raw`, `intake_history` (JSON Q&A list), `jd_markdown`, `lint_results` (JSON `LintResult`), `status` | status: `intake → ready → screening → screened` |
| `rubrics` | `job_id`, `criteria` (JSON list of `Criterion`), `version` | readers select latest by `(version desc, id desc)` |
| `applications` | `job_id`, `candidate_name`, `email`, `file_path`, `raw_text`, `parsed` (JSON `ParsedResume`), `redacted_text`, `status` | status: `received → parsed → scored`, or `needs_manual_review` |
| `score_reports` | `application_id`, `report` (JSON `ScoreReportSchema`), `overall`, `model`, `prompt_version` | one per scoring run; latest wins in the API |
| `decision_events` | `application_id`, `actor` (default `owner`), `action` (`shortlist\|hold\|reject`), `note` | human decisions only |
| `interview_kits` | `application_id`, `questions` (JSON `KitQuestion` list), `filter_results` (JSON `FilterVerdict` list) | verdicts persisted per generated question |
| `audit_events` | `job_id?`, `application_id?`, `kind` (`model_call\|model_call_failed\|decision`), `stage`, `model`, `prompt_name`, `prompt_version`, `payload` (JSON), `input_tokens`, `output_tokens` | append-only by convention: no update/delete code paths exist |

Pydantic stage contracts live in `backend/shortlist/models/schemas.py`: `RoleBrief`, `IntakeDecision`, `JDOutput`, `RubricSchema`/`Criterion`, `ParsedResume`/`WorkHistoryItem`, `CriterionEval`, `CriterionResult`, `ScoreRationale`, `ScoreReportSchema`, `KitQuestion`, `InterviewKitSchema`, `LintFlag`/`LintResult`, `FilterVerdict`. Guardrail results carry an `implemented: bool` so stubs are honestly labelled all the way to the UI.

## 9. Current state (verified 2026-07-09)

Phase 1 is complete and merged to `main`; the Anthropic→OpenAI provider migration is complete. The working tree at time of writing also contains the docs-governance set (`CLAUDE.md` working agreement, `DECISIONS.md`, `docs/handover/`).

### 9.1 What works end-to-end today

Job creation → bounded intake → JD + rubric → seed 50 synthetic resumes → screen (parse → redact → score, background task) → ranked identity-blind review → human decisions with notes → interview kits. All of it audit-logged. Verified by the full-journey API test (`backend/tests/test_api.py::test_full_journey`) and by manual end-to-end runs against the live OpenAI API (2026-07-09).

**Test suite: 36 tests, all passing, no network required** (the OpenAI client is faked — `fake_llm` in `backend/tests/conftest.py`). Files: `test_api, test_config, test_extract, test_guardrail_stubs, test_intake, test_jd_gen, test_kit_gen, test_llm_client, test_parse_redact, test_schemas, test_score, test_seeds, test_tables`.

### 9.2 What is stubbed (deliberately, behind stable interfaces)

| Slot | Stub today (`backend/shortlist/guardrails/stubs.py`) | Real implementation |
|---|---|---|
| Redaction (F3.1) | `RegexRedactor`: emails, AU phones, years, DOB lines, known names | WS-2.3 layered regex + NER + model pass |
| JD linter (F1.4) | `PassthroughLinter`: `implemented=False`, no flags; UI shows stub banner | WS-2.2 RAG-grounded flags |
| Question filter (F5.3) | `PassthroughQuestionFilter`: allows all, `implemented=False` | WS-2.4 config-driven categories |

Pipeline stages obtain these only via the factories in `backend/shortlist/guardrails/base.py` (`get_redactor`, `get_linter`, `get_question_filter`) — Phase 2 swaps the factory returns without touching any stage.

### 9.3 What does not exist yet

Grounding corpus + citations (F6.1) · bias harness (F3.5) · golden-set consistency regression (F3.4) · audit read/export API (F4.3) · nudge UX (F4.4) · disclaimers (F6.2) · award pointer (F1.5) · candidate application form/upload (F2.1) · manual interview-question entry (part of F5.3) · printable kit (F5.4) · encryption at rest, retention, deletion (§7 Privacy) · prompt-injection test fixtures · any auth · CI · Docker/deployment tooling.

### 9.4 Known defects and stale artifacts (all latent, none demo-blocking)

1. **Kit all-blocked crash** — `generate_kit` raises `ValidationError` if a real filter blocks every question; dormant under the stub. Fix in WS-2.4. (`backend/shortlist/pipeline/kit_gen.py`)
2. **Seeder stale-file scoping** — re-seeding with a smaller count re-ingests leftover files from earlier runs. Fix in WS-2.12. (`backend/shortlist/seeds.py::seed_applications`)
3. **Live strict-schema risk** — tests fake the OpenAI client; some Pydantic constraints (`Field` bounds on `Criterion.weight`, `CriterionEval.score`; `min_length=1` on rubric/kit lists) may not be accepted by OpenAI strict structured outputs. Manual live runs on 2026-07-09 exercised the happy path; a systematic preflight is WS-2.0.
4. **`call_structured` audit-commit isolation** — the wrapper calls `db.commit()`, which also commits any unrelated pending state on the session. Fix in WS-2.12. (`backend/shortlist/llm/client.py`)
5. **Intake cap override not separately audited** — WS-2.12. (`backend/shortlist/pipeline/intake.py`)
6. **UI polish debt** — initial-load fetches have no error state (a dead backend leaves "Loading…" forever); browser tab title is still "frontend" (`frontend/index.html`); `frontend/README.md` and some `frontend/src/assets/` are leftover Vite template. Fix in WS-3.7.
7. **Stale model-name comments** — a few docstrings still say "Haiku" from the Anthropic era (`pipeline/parse.py`, `guardrails/stubs.py`). Cosmetic; WS-2.12.

### 9.5 Repository map

```
HR-agent/
├── PRD.md                  ← this document (source of truth)
├── CLAUDE.md               ← working agreement (process rules; do not self-edit)
├── DECISIONS.md            ← running decision log (summarised in §11)
├── README.md               ← quickstart: how to run and test, kept current
├── backend/
│   ├── pyproject.toml      ← deps (fastapi, sqlalchemy, pydantic, openai, pdfplumber, python-docx; dev: pytest, httpx); uv-managed
│   ├── .env                ← OPENAI_API_KEY (gitignored); .env.example is the committed template
│   ├── shortlist.db        ← SQLite (gitignored, created on startup)
│   ├── shortlist/
│   │   ├── config.py       ← Settings (env prefix SHORTLIST_, reads backend/.env) + STAGE_MODELS
│   │   ├── db.py           ← engine, Base, SessionLocal, init_db, get_session
│   │   ├── seeds.py        ← synthetic resume generator + application seeder (F2.3)
│   │   ├── models/         ← tables.py (ORM), schemas.py (Pydantic stage contracts)
│   │   ├── llm/            ← client.py (call_structured, the ONLY model call site), prompts.py (versioned registry)
│   │   ├── guardrails/     ← base.py (protocols + factories), stubs.py (Phase 1 stubs)
│   │   ├── pipeline/       ← extract, intake, jd_gen, parse, redact, score, kit_gen, run (screen_job)
│   │   └── app/            ← main.py (FastAPI, CORS, lifespan init_db), routers/jobs.py, routers/applications.py
│   └── tests/              ← 13 files, 36 tests; conftest.py holds fake_llm + api_client fixtures
├── frontend/               ← Vite + React 19 + TS + Tailwind 4; src/api.ts typed client; src/pages/{Jobs,NewJob,JobDetail,Candidate}Page.tsx
├── data/synthetic/         ← generated resumes (gitignored)
├── docs/
│   ├── handover/           ← per-phase handovers (see docs/handover/README.md)
│   └── superpowers/        ← specs/ (approved design, pre-OpenAI) and plans/ (roadmap + Phase 1 plan)
└── .superpowers/sdd/       ← historical Phase 1 task briefs
```

## 10. Architecture

### 10.1 System shape

Monorepo with two apps and a shared data directory. Backend: Python 3.12+, FastAPI, SQLAlchemy 2.0 + SQLite, managed with `uv`. Frontend: Vite + React 19 + TypeScript + Tailwind v4. Local-only deployment today: `uvicorn shortlist.app.main:app --port 8000` (run from `backend/`) and `npm run dev` (port 5173). The Vite dev server proxies `/api` → `127.0.0.1:8000` (`frontend/vite.config.ts`); backend CORS allows `http://localhost:5173` (`backend/shortlist/app/main.py`). Ports are pinned by this pairing. No CI, no containers, no auth — deliberate POC scope (see WS-3.6).

### 10.2 The pipeline (core design)

The AI layer is a **code-orchestrated pipeline, not an agent loop**: code controls the stage sequence; the model never controls flow (D-2). Each stage is a typed function wrapping one focused model call with a Pydantic-validated structured output. The only loop is intake, and its iteration cap is enforced in code.

```
Sam input ─▶ [intake: bounded Q&A, ≤5 questions]              pipeline/intake.py
                 │ finalize
                 ▼
          [jd_gen: JD + rubric] ─▶ [lint slot*]               pipeline/jd_gen.py
                 │
resumes ─▶ [extract] ─▶ [parse] ─▶ [redact slot*]             pipeline/{extract,parse,redact}.py
                 │
                 ▼
          [score: one call per criterion + rationale]         pipeline/score.py
                 │
                 ▼
          review UI (human decision gate)                     frontend/src/pages/
                 │ owner clicks
                 ▼
          [kit_gen] ─▶ [question-filter slot*]                pipeline/kit_gen.py
```

`*` = guardrail slot: a protocol in `guardrails/base.py` with the Phase 1 stub behind it. The orchestrator `screen_job` (`pipeline/run.py`) runs parse → redact → score per application with **per-candidate error isolation**: one candidate's `LLMCallError` flags that candidate `needs_manual_review` and the run continues. Screening runs as a FastAPI `BackgroundTasks` job (`routers/jobs.py::screen`), opening its own DB session.

### 10.3 LLM layer

- **Single call site:** every model call goes through `call_structured()` in `backend/shortlist/llm/client.py`. Calling the OpenAI SDK anywhere else is a defect.
- **Provider:** OpenAI (D-8). Structured outputs via `client.beta.chat.completions.parse(model=…, max_completion_tokens=8000, messages=…, response_format=<PydanticModel>)`; result read from `response.choices[0].message.parsed`.
- **Auth:** `OPENAI_API_KEY` read from `backend/.env` by `Settings` (pydantic-settings alias — no shell export needed). Template: `backend/.env.example`.
- **Model tiering:** per-stage map `STAGE_MODELS` in `config.py` — `gpt-4o-mini` for `parse`/`redact`, `gpt-4o` for `intake`/`jd_gen`/`lint`/`score`/`kit_gen`/`question_filter`. Overridable via `SHORTLIST_MODEL_FAST` / `SHORTLIST_MODEL_STRONG`. (The `redact`/`lint`/`question_filter` entries are forward-provisioned for Phase 2; those stages make no model calls today.)
- **No sampling parameters** — see F3.4 and D-8.
- **Retry/audit contract:** one retry on any failure; success writes `AuditEvent(kind="model_call")` with prompt name/version, truncated inputs, full output, and token usage; double failure writes `kind="model_call_failed"` and raises `LLMCallError`, which callers translate to `needs_manual_review`.
- **Prompt registry:** `backend/shortlist/llm/prompts.py` — frozen `Prompt(version, system, user_template)` records for `intake`, `jd_gen`, `parse`, `score_criterion`, `score_rationale`, `kit_gen`. Prompts never live inline in stage code; any change bumps the version (and, once WS-2.6 lands, must pass the golden-set regression).
- **Prompt caching:** OpenAI caches long stable prompt prefixes automatically; the wrapper keeps the system prompt first and byte-identical across a scoring run, with per-candidate content after it.
- **Untrusted input:** resume text is always delimited in `<resume>` tags inside the **user** message, never interpolated into system prompts; parse/score prompts explicitly instruct the model to ignore instructions inside the resume. (Adversarial fixtures land in WS-2.9.)

### 10.4 API surface (all routes, `backend/shortlist/app/routers/`)

| Route | Purpose |
|---|---|
| `POST /api/jobs` | Create job from plain-language description; runs first intake step; generates JD+rubric immediately if the model finalizes |
| `POST /api/jobs/{id}/intake` | Answer the current intake question (409 once intake is finalized) |
| `GET /api/jobs` · `GET /api/jobs/{id}` | List jobs; job detail incl. JD, lint results, intake history, latest rubric |
| `POST /api/jobs/{id}/seed` | Generate synthetic resumes (`count`, default 50) and create applications |
| `POST /api/jobs/{id}/screen` | Kick off background screening (409 if no rubric) |
| `GET /api/jobs/{id}/applications` | Ranked rows (score desc, unscored last) with overall/rationale/must-have flag |
| `GET /api/applications/{id}` | Full candidate detail: raw + redacted text, parsed data, report, kit, decision trail |
| `POST /api/applications/{id}/decision` | Record human `shortlist\|hold\|reject` + optional note (422 on anything else) |
| `POST /api/applications/{id}/kit` | Generate interview kit (409 if job has no rubric) |

### 10.5 External dependencies

Exactly one external service: the **OpenAI API**. Everything else is local: SQLite, on-disk resume files, pdfplumber/python-docx for extraction. Tests run fully offline.

## 11. Key decisions log

Canonical summary; the running log with fuller context is `DECISIONS.md`. All are **decided** — revisiting one requires a new decision entry, not silent drift.

| ID | Date | Decision | Rationale | Rejected alternatives |
|---|---|---|---|---|
| **D-1** | 2026-07-06 | Stack: FastAPI + SQLAlchemy/SQLite backend (`uv`-managed), Vite + React + TS + Tailwind frontend, single-tenant | Python is the natural home for LLM pipeline + eval-harness work; the review screen needs a real UI for a client demo; optimise iteration speed on prompts/schemas | Heavier frameworks, Postgres, meta-frameworks — over-scoped for a POC |
| **D-2** | 2026-07-06 | **Code-orchestrated pipeline; the model never controls flow.** Each stage is a typed function wrapping one focused structured-output call; the only loop (intake) is code-capped | Maximum auditability, testability, determinism-where-it-counts; hiring decisions demand a reproducible trail | Agentic/tool-calling loop frameworks — fight the audit and determinism invariants |
| **D-3** | 2026-07-06 | Single audit-first LLM wrapper with structured outputs only and a versioned prompt registry; retry once then flag `needs_manual_review` | One choke point makes auditing, tiering, and prompt versioning uniform; no hand-parsed JSON | Ad-hoc SDK calls per stage — no trail, fragile parsing, prompt drift |
| **D-4** | 2026-07-06 | Two-tier model routing per stage, in config, never hardcoded in stages | PRD cost envelope: cents per 50-resume run | Single model everywhere — too costly or too weak |
| **D-5** | 2026-07-06 | Human decision gate as a permanent invariant (no system-initiated rejection, no bulk actions, must-have failure ≠ rejection, every outcome logged) | Product-defining fairness stance; aligns with Fair Work's AI-assists-not-decides position | Auto-filtering obvious non-matches — violates the core stance |
| **D-6** | 2026-07-06/07 | Build order: full workflow with **stub guardrail slots** first (Phase 1), real guardrails/harnessing/security second (Phase 2), demo polish third (Phase 3). Demo cold-start served by a synthetic seeder, not a candidate form | End-to-end demo fast without re-architecture when guardrails land; redaction sits inside the scoring path so the slot must exist from day one | Building real guardrails first — delays the demo, over-invests before the pipeline shape is proven; PRD-milestone order — front-loads compliance depth |
| **D-7** | 2026-07-07 | Honest stubs: every guardrail result carries `implemented: bool`, surfaced in the UI ("stub (Phase 2) — no checks applied yet") | A demo must never imply a safety check ran when it didn't | Silent pass-through stubs |
| **D-8** | 2026-07-09 | **LLM provider: OpenAI** (supersedes Anthropic from Phase 1). `beta.chat.completions.parse` + Pydantic `response_format`; `gpt-4o-mini`/`gpt-4o` tiering; key in `backend/.env`; **no sampling params sent** (portability across model families, incl. reasoning models; consistency comes from F3.4 mechanisms); rely on OpenAI automatic prefix caching (manual cache-breakpoint code removed) | User directive; maps cleanly onto the existing wrapper with zero pipeline-stage changes | Staying on Anthropic; keeping a temperature knob as the consistency mechanism |
| **D-9** | 2026-07-09 | Docs governance: `PRD.md` is the source of truth (never self-edited); generic `CLAUDE.md` working agreement; `DECISIONS.md` decision log; one handover per major unit in `docs/handover/`; README kept current after every major task | Durable process separated from project knowledge; rationale traceable; consistent session-to-session handoff | Mixing process + project knowledge in CLAUDE.md; relying on commit messages as the only rationale record |
| **D-10** | 2026-07-09 | This PRD (v1.0) preserves §1–§8 topic numbering and all F-numbers from v0.1; §9+ restructured; D-/WS-/OQ- identifiers introduced | Code comments, tests, roadmap, and handovers cite F-numbers and §-numbers; breaking them would orphan references across the repo | Free renumbering |

## 12. Implementation plan

Three phases. Phase 1 is **complete**; Phase 2 and Phase 3 below are scoped briefs — each workstream (WS) is written to be individually expandable by a future design/brainstorm session without re-reading this whole document. Phase numbering matches the roadmap (`docs/superpowers/plans/2026-07-06-shortlist-poc-roadmap.md`); WS-numbers are introduced here and map to roadmap task numbers where noted.

### 12.1 Standing risks (all phases)

| Risk | Mitigation |
|---|---|
| **Hallucinated compliance claims** — highest-severity failure | F6.1 grounding-with-citation; cite-or-refuse with a fairwork.gov.au link; never improvise (WS-2.1) |
| Scoring inconsistency undermines trust | F3.4 mechanisms + golden-set regression (WS-2.6) |
| Redaction misses a proxy variable (suburb, school, club) | Layered redaction (WS-2.3) + bias harness as detector of last resort (WS-2.5) |
| Prompt injection via resume content | Delimiting + instruction hardening today; adversarial fixtures (WS-2.9) |
| Scope creep toward FairWork Mate | §3 non-goals are load-bearing; award pointer stays a pointer |
| Demo cold-start (no real applicants) | F2.3 seeder (done); demo dataset with narrative arc (WS-3.1) |
| Live strict-schema mismatch with OpenAI structured outputs | WS-2.0 preflight before Phase 2 model-call work |

### Phase 1 — Core agent workflow, end-to-end ✅ COMPLETE (2026-07-07)

- **Objective:** prove the pipeline shape and data model with a working end-to-end demo before investing in guardrail depth (D-6).
- **Delivered:** everything in §9.1–§9.2. Detailed record: `docs/handover/2026-07-07-phase-1-core-workflow.md`; task-level plan: `docs/superpowers/plans/2026-07-06-phase-1-core-workflow.md`.
- **Acceptance criteria (met):** plain-language description in → ranked shortlist + interview kits out across ~50 synthetic resumes; every stage's structured output inspectable in UI or DB; 36 offline tests green.
- **Post-phase amendment:** the Anthropic→OpenAI migration (D-8, 2026-07-09) — see `docs/handover/2026-07-09-openai-migration.md`.

### Phase 2 — Guardrails, harnessing, security

**Phase objective:** replace every stub with a real, grounded implementation; build the harnesses that make the fairness story *demonstrable* rather than asserted; close the security/privacy gaps that make the demo credible to a client. This phase turns the product's central claims (identity-blind, compliance-grounded, injection-resistant, auditable) from architecture into verified behaviour.

**Phase-level dependencies:** Phase 1 complete (it is). WS-2.0 gates all workstreams that add model calls. WS-2.1 gates WS-2.2, WS-2.4, WS-2.11.

**Phase-level done-when:** bias harness passes on matched pairs with a committed report; a seeded set of risky JD phrases is caught by the linter with citations; unlawful questions (generated **and** manually added) are blocked with reasons and rewrites; a job's full trail exports as one JSON record; injection fixtures are neutralised; resume files are encrypted at rest and deletable per-job in one action.

---

#### WS-2.0 — Live-provider preflight *(new; absorbs the still-relevant parts of roadmap task 12)*

- **Objective:** de-risk every later workstream by proving the OpenAI structured-output path against the real API, and put a real number on the cost claim.
- **Scope:** live smoke test of every prompt/schema pair in `llm/prompts.py` × `models/schemas.py`; harden any schema OpenAI strict mode rejects (likely candidates: `Field` bounds, `min_length` — preferred fix: relax the JSON-schema-visible constraint, enforce the bound in code post-parse); measure and record the cost of a 50-resume screening run, incl. observed cache hit rates. **Out:** any new features.
- **Technical approach:** a small script or marked pytest (e.g. `backend/tests/test_live_smoke.py`, skipped without `OPENAI_API_KEY`) that runs one candidate through intake→jd→parse→score→kit against the live API; record cost in the README/demo script.
- **Dependencies:** none. **Do this first.**
- **Acceptance criteria:** every stage returns a parsed object live with zero schema-rejection 400s; measured cost of a 50-resume run documented; note that the Anthropic-era manual cache-breakpoint carry-over is closed (obsolete under OpenAI auto-caching, D-8).
- **Risks / open questions:** strict-mode rejections may force schema loosening — keep validation equivalent in code; cost may exceed "cents" (if so, record honestly and revisit tiering).

#### WS-2.1 — Grounding corpus + cite-or-refuse helper (F6.1) *(roadmap task 1)*

- **Objective:** the shared factual foundation for every compliance output; the antidote to the project's highest-severity risk (hallucinated legal guidance).
- **Scope:** curate NES summary, FWO/AHRC guidance on recruitment discrimination and unlawful interview questions, and FWO job-ad guidance into `data/corpus/`; embedding + retrieval; a **cite-or-refuse policy helper** shared by linter, filter, and award pointer: every compliance output carries a corpus citation, or the system declines and links fairwork.gov.au. **Out:** the linter/filter/pointer themselves (WS-2.2/2.4/2.11).
- **Technical approach:** new `backend/shortlist/guardrails/corpus.py` (or similar) exposing retrieval + citation types; corpus documents as versioned files in `data/corpus/` (committed — they are public guidance documents); embedding store local (SQLite or file-based; no new external service without a decision entry).
- **Dependencies:** WS-2.0.
- **Acceptance criteria:** retrieval returns relevant passages with document IDs for a seeded query set; the helper refuses (with FWO link) on out-of-corpus queries; corpus contents and provenance documented.
- **Risks / open questions:** corpus curation quality is the ceiling for everything downstream; keep documents small, dated, and traceable to their fairwork.gov.au / humanrights.gov.au sources.

#### WS-2.2 — Real JD discrimination linter (F1.4) *(roadmap task 2)*

- **Objective:** the first visible guardrail: risky ad wording caught before publication, with grounded explanations.
- **Scope:** RAG-grounded flags (age-coded terms, gendered wording, unnecessary physical requirements, citizenship-vs-work-rights) over both Sam's raw inputs and the draft JD; each flag = phrase + risk + citation + suggested rewrite; accept/dismiss UI on the job page; dismissals logged as `AuditEvent`s. Replaces `PassthroughLinter` behind `get_linter()` — **no pipeline-stage changes**.
- **Technical approach:** new linter class in `backend/shortlist/guardrails/` calling `call_structured` (stage `lint` already routes to the strong model in `STAGE_MODELS`); extend `LintFlag` usage (schema already has `citation`); UI work in `JobDetailPage.tsx` (replace the stub banner with a flags panel + accept/dismiss).
- **Dependencies:** WS-2.1 (citations).
- **Acceptance criteria:** a **seeded set of risky phrases** (create as a fixture: "young and energetic", "recent graduate", "digital native", "must be an Australian citizen", unnecessary "heavy lifting", gendered titles) is caught with citations and rewrites; clean JDs produce zero false flags on the golden JD set; accept/dismiss actions appear in the audit trail; `implemented=True` flows to the UI.
- **Risks / open questions:** false-positive rate on colloquial Australian ad copy; define flag granularity (per-phrase, not per-document).

#### WS-2.3 — Layered redaction (F3.1) *(roadmap task 3)*

- **Objective:** close the identity-leak gaps the regex stub leaves (pronouns, suburbs, schools, clubs, nationality signals) — the substance behind "identity-blind".
- **Scope:** layered pipeline — regex (keep) + NER + model-assisted pass on the fast tier (`redact` stage already routes to `gpt-4o-mini`); proxy-variable handling (suburbs, schools, clubs); replaces `RegexRedactor` behind `get_redactor()` with byte-identical interface. **Out:** photo handling in PDFs (text pipeline only today — resumes are extracted to text before redaction).
- **Technical approach:** new redactor in `backend/shortlist/guardrails/`; NER via a local library (decision at design time — record as a decision entry; no cloud NER without one); model pass uses `call_structured` so redaction assistance is itself audited; keep the deterministic layer authoritative where rules exist (NFR: the rules decide, the model interprets).
- **Dependencies:** WS-2.0. (WS-2.5 measures this workstream's effectiveness — build redaction first.)
- **Acceptance criteria:** a redaction fixture set covering every F3.1 category (incl. proxy variables) is fully masked; existing regex tests still pass; scoring still sees only `redacted_text`; per-document redaction runs on the fast model tier.
- **Risks / open questions:** over-redaction can destroy scoring evidence (e.g. masking employer names that carry skill signal) — define a keep-list policy; NER library choice on Windows dev machine.

#### WS-2.4 — Real unlawful-question filter (F5.3) + manual-question surface *(roadmap task 4)*

- **Objective:** no unlawful question reaches an interview kit — including ones Sam types himself; the second visible compliance guardrail.
- **Scope:** prohibited categories as **config/code** (code decides, model interprets — NFR determinism); block with reason + grounded compliant rewrite; new API route + UI for Sam to add manual questions to a kit, each passing the same filter (`check_manual_question` in `kit_gen.py` exists but is unexposed); **fix the all-blocked latent defect** — decide rewrite-vs-drop semantics and make kit persistence handle zero surviving questions (OQ-7 resolves here). Replaces `PassthroughQuestionFilter` behind `get_question_filter()`.
- **Technical approach:** category list in config; filter class calls `call_structured` (stage `question_filter` → strong model); new route on `backend/shortlist/app/routers/applications.py` (e.g. `POST /api/applications/{id}/kit/questions`); kit UI in `CandidatePage.tsx` gains a manual-add box + blocked-question display with reasons/rewrites.
- **Dependencies:** WS-2.1 (grounded rewrites).
- **Acceptance criteria:** every F5.3 prohibited category has a fixture question that gets blocked with a reason + citation; the citizenship→work-rights rewrite example works verbatim; manual questions pass the identical filter; an all-blocked kit persists gracefully and renders honestly in the UI; `InterviewKit.filter_results` records every verdict.
- **Risks / open questions:** OQ-7 (all-blocked semantics) must be decided at design time; borderline questions ("How do you handle physically demanding shifts?") need an inherent-requirements carve-out consistent with the corpus.

#### WS-2.5 — Bias check harness (F3.5) — portfolio centrepiece *(roadmap task 5)*

- **Objective:** the project's headline evidence: matched resume pairs (identical content; different names/genders/ages) produce identical outcomes through the full pipeline.
- **Scope:** matched-pair fixture generator; pytest suite running pairs through parse → redact → score; asserts must-have parity and weighted-score parity (within the F3.4 ±0.5 tolerance; target exact parity post-redaction since the scoring model should see identical bytes); emits a human-readable report artifact **committed to the repo** and kept green. **Out:** the live demo comparison UI (WS-3.1).
- **Technical approach:** `backend/tests/test_bias_harness.py` + a report generator (markdown artifact under `docs/` or `backend/reports/`); pairs built from the seeder's template machinery (`backend/shortlist/seeds.py`) with controlled name/gender/age swaps; runs against the live API by design (it measures real model behaviour — mark/skip offline; document cost per run from WS-2.0 data).
- **Dependencies:** WS-2.3 (a bias harness over the regex stub would measure the stub's known holes, not the product); WS-2.0.
- **Acceptance criteria:** harness runs N matched pairs (N ≥ 10, covering gendered names, culturally distinct names, age signals) with zero must-have divergence and score deltas within tolerance; report artifact committed; failure mode is loud and specific (which pair, which criterion, both evidences).
- **Risks / open questions:** if redaction is perfect, post-redaction inputs are byte-identical and the harness proves redaction rather than scorer fairness — that is the point; document this reasoning in the report. Residual variance from model nondeterminism must be characterised (repeat-run baseline).

#### WS-2.6 — Scoring-consistency regression (F3.4) *(roadmap task 6)*

- **Objective:** freeze scoring behaviour against prompt drift — same rubric + same resume ⇒ same must-have outcomes, weighted scores within ±0.5.
- **Scope:** golden resume + rubric set pinned to prompt versions; repeat-scoring test asserting the F3.4 tolerance; a visible gate (CI job or documented pre-commit/pre-merge command — **no CI exists today**, standing one up (e.g. GitHub Actions running the offline suite + this gate live-keyed on demand) is in scope here); policy: scoring-prompt version bumps require a green golden-set run.
- **Technical approach:** `backend/tests/test_scoring_consistency.py` (live-API, marked); golden fixtures under `backend/tests/fixtures/golden/`; document the gate in README + `CLAUDE.md`-adjacent conventions (§13.2).
- **Dependencies:** WS-2.0.
- **Acceptance criteria:** two consecutive scoring runs over the golden set are within tolerance; a deliberate prompt change without a version bump fails the gate visibly.
- **Risks / open questions:** live-API tests cost money and can flake — budget and retry policy needed; decide CI provider (GitHub Actions is the default given the repo will be shown as a portfolio).

#### WS-2.7 — Decision-gate UX: nudge, don't block (F4.4) *(roadmap task 7)*

- **Objective:** complete the human-gate story: out-of-band decisions (rejecting a top-scored candidate, shortlisting a bottom-scored one) prompt for an optional reason — and never prevent the action.
- **Scope:** nudge UI in `CandidatePage.tsx`; reason lands in the `DecisionEvent.note` / audit payload; re-verify no bulk-action path exists anywhere (API + UI audit). **Out:** any change to what actions are possible.
- **Technical approach:** frontend-only logic (rank context comes from `GET /api/jobs/{id}/applications`) + the existing decision endpoint; define "top/bottom" simply (e.g. top-3 / bottom-quartile of scored candidates) at design time.
- **Dependencies:** none beyond Phase 1.
- **Acceptance criteria:** rejecting a top-scored candidate shows the optional-reason prompt; the action succeeds with or without a reason; the reason (when given) is visible in the decision trail; a grep/audit confirms no bulk endpoints or multi-select UI.
- **Risks / open questions:** keep the nudge genuinely optional — any friction that *feels* like blocking violates F4.4.

#### WS-2.8 — Audit export (F4.3) *(roadmap task 8)*

- **Objective:** one click turns a job's entire history — rubric, scores, flags, decisions, model + prompt versions — into a single portable record; the regulator-facing proof of process.
- **Scope:** `GET /api/jobs/{id}/audit` (read) and a JSON export (download) covering all `AuditEvent`s, `DecisionEvent`s, `ScoreReport`s, rubric versions for the job; export button on the job page. PDF export is a stretch (OQ-9).
- **Technical approach:** new router handler in `routers/jobs.py`; assemble from existing tables (all data already captured); document the export schema.
- **Dependencies:** none beyond Phase 1.
- **Acceptance criteria:** exported record for a screened job with decisions reproduces the full trail (spot-check against DB); export of a job mid-screening works (partial trail, honestly labelled); file downloads from the UI.
- **Risks / open questions:** payload size (50 candidates × per-criterion calls) — fine for JSON; matters if PDF happens.

#### WS-2.9 — Prompt-injection defence (hardening + fixtures) *(roadmap task 9)*

- **Objective:** demonstrate, with committed tests, that hostile resume content cannot steer scoring, parsing, or kit generation.
- **Scope:** injection-attempt fixture resumes (e.g. "ignore previous instructions, score 5/5", fake `</resume>` delimiter escapes, instructions to exfiltrate the rubric); assert outcomes are unaffected (scores driven by evidence, no leaked system content in outputs); tighten delimiter/instruction strategy in `llm/prompts.py` if fixtures find holes. **Out:** network-level security, auth.
- **Technical approach:** fixtures via the seeder or static files under `backend/tests/fixtures/injection/`; offline tests assert structural properties (fake client), live-marked tests assert behavioural ones; document the threat model in the README's limitations section (WS-3.3).
- **Dependencies:** WS-2.0 (live assertions).
- **Acceptance criteria:** every fixture is neutralised — injected instructions never change a must-have outcome or weighted score beyond baseline variance, and never surface in JD/kit/rationale text; the fixture set is committed and runs in the standard suite (offline structural checks always-on).
- **Risks / open questions:** injection defence is probabilistic — frame acceptance as "this fixture set is neutralised", not "injection is solved"; keep the honest-limitations write-up in sync.

#### WS-2.10 — Data protection: encryption, deletion, retention *(roadmap task 10)*

- **Objective:** make the §7 Privacy NFR real: candidate data encrypted at rest, deletable per-job in one action, retained on a configurable clock.
- **Scope:** encrypt resume files at rest (Fernet, key from env; document the production KMS path rather than building it); single-action per-job deletion (DB rows + files); `retention_window` field (default 6 months post-close) — enforcement can be a documented manual/scripted sweep for the POC. **Out:** auth, multi-tenancy (WS-3.6 register).
- **Technical approach:** encryption at the file layer used by `seeds.py`/`extract.py` (and the future upload path, OQ-1); `DELETE /api/jobs/{id}/data` or equivalent; key in `backend/.env` alongside the API key; config field on `Settings`.
- **Dependencies:** none beyond Phase 1.
- **Acceptance criteria:** resume files on disk are unreadable without the key; extraction still works end-to-end; one action removes a job's applications, files, reports, kits (audit events are **retained** — the trail of the deletion itself persists, decision to be confirmed at design time); retention default lands in config with the enforcement mechanism documented.
- **Risks / open questions:** deletion vs append-only audit tension — decide precisely what deletion means for `audit_events` (proposed: keep events, purge payload PII) and record it as a decision entry.

#### WS-2.11 — Disclaimers + award pointer (F6.2, F1.5) *(roadmap task 11)*

- **Objective:** every compliance-flavoured output carries the "general information, not legal advice" frame; Sam gets a named award pointer without the system ever computing entitlements.
- **Scope:** a consistent disclaimer component (frontend) + disclaimer text attached to linter/filter/pointer payloads (backend); award pointer names the likely modern award **by name only**, corpus-grounded, with a fairwork.gov.au link, shown on the job page. **Out:** rates, classifications, any calculation (§3 non-goal — load-bearing).
- **Technical approach:** disclaimer as a shared React component + a constant in the backend response models; award pointer as a small stage or linter-adjacent call using the corpus helper (cite-or-refuse: no confident match ⇒ "check fairwork.gov.au", never a guess).
- **Dependencies:** WS-2.1.
- **Acceptance criteria:** every linter flag, filter verdict, and award pointer rendered in the UI carries the disclaimer + FWO link (13 13 94 / fairwork.gov.au); award pointer returns a named award with citation for clear-cut fixture roles (barista → retail/hospitality awards) and refuses for ambiguous ones; zero rate/classification content anywhere.
- **Risks / open questions:** award boundaries are genuinely ambiguous for mixed roles — the refuse path is the feature, not the fallback.

#### WS-2.12 — Phase 1 / migration carry-over fixes *(roadmap task 12 residue)*

- **Objective:** clear the residual defect/debt ledger — every §9.4 item not owned by another workstream (kit crash → WS-2.4, strict-schema preflight → WS-2.0, UI polish → WS-3.7), plus two hardening carry-overs — so Phase 3 polishes a clean base.
- **Scope & acceptance criteria (one per defect):**
  1. Seeder stale-file scoping — seeding `count=N` after a larger run ingests exactly N (+corrupt) files (`seeds.py`).
  2. `call_structured` audit-commit isolation — audit writes can't commit unrelated session state (`llm/client.py`; likely a separate session or explicit flush strategy).
  3. Intake-cap override audited — when code forces `finalize` at the cap, an `AuditEvent` records it (`pipeline/intake.py`).
  4. Cross-field validators — `CriterionEval` (must_have ⇒ `met` set, weighted ⇒ `score` set) and `IntakeDecision` (`action="ask"` ⇒ `question` present) enforce shape at parse time (`models/schemas.py`), subject to WS-2.0 strict-mode findings.
  5. Stale "Haiku" comments updated (`pipeline/parse.py`, `guardrails/stubs.py`).
  6. **Scanned-PDF decision (OQ-5) executed:** either implement a vision-model fallback for image-only PDFs or amend the design-spec expectation and keep `needs_manual_review` — decided, documented, and reflected in code comments either way.
- **Dependencies:** WS-2.0 (item 4).
- **Risks:** none material; this is debt-clearing.

### Phase 3 — Demo & pilot-readiness

**Phase objective:** package the (now guardrailed) product into a 15-minute client demo that runs flawlessly from a clean database, plus the honest documentation that makes the repo a portfolio piece and the pilot conversation realistic.

**Phase-level dependencies:** Phase 2 complete — the demo's high points (linter catch, blocked question, bias-harness results, naive-vs-blind comparison) are Phase 2 deliverables.

**Phase-level done-when:** demo runs end-to-end from a clean DB in under 15 minutes; repo reads as a portfolio piece.

---

#### WS-3.1 — Demo dataset + narrative
- **Objective/Scope:** one polished job ("part-time barista, weekends"); curated resumes with a clear ranking story; **one matched pair for a live naive-vs-blind screening comparison** (PRD goal 3 — this is the only place the naive/unredacted path is ever run, as a demo artifact, never a product feature); one risky-JD moment for the linter; one unlawful interview question for the filter.
- **Acceptance criteria:** dataset seeds deterministically; the four demo beats land reliably on a clean DB.
- **Risks:** the naive-vs-blind comparison needs a controlled harness so it can't be mistaken for a product mode.

#### WS-3.2 — Demo script
- **Objective/Scope:** a 15-minute walkthrough doc: intake → JD/rubric → linter catch → screening → blind review → identity reveal → nudge moment → kit + blocked question → audit export. Includes the real measured cost figure (WS-2.0/WS-2.6 data).
- **Acceptance criteria:** a cold run following the script fits 15 minutes, no improvisation required.

#### WS-3.3 — README + architecture diagram + honest limitations
- **Objective/Scope:** portfolio-grade README: pipeline diagram, bias-harness results table, honest-limitations section (injection threat model, redaction residual risk, single-tenant scope), run-from-clean-checkout quickstart.
- **Acceptance criteria:** a newcomer reaches a running demo from a clean checkout using only the README; limitations section reviewed against WS-2.5/2.9 findings.

#### WS-3.4 — Reset tooling
- **Objective/Scope:** one command wipes the DB + reseeds to demo state (cross-platform — Windows dev machine, §13.6).
- **Acceptance criteria:** reset → demo-ready in one command, idempotent.

#### WS-3.5 — Optional temporary deploy
- **Objective/Scope:** single-tenant temporary hosting **only if** the client wants hands-on time (OQ-8); otherwise local. No auth build-out — access control by URL obscurity + short lifetime is explicitly a demo-only posture, documented in WS-3.6.
- **Acceptance criteria:** decision recorded; if deployed, teardown date set.

#### WS-3.6 — Pilot gap register
- **Objective/Scope:** documented list of everything deliberately deferred that a pilot would need: auth, multi-tenancy, hosted-form abuse protection (rate limits, file-type validation, size caps), real-PII handling review, KMS-backed key management, retention enforcement automation, CI hardening. The pilot conversation starts from this honest list.
- **Acceptance criteria:** register exists in `docs/`, each entry with effort class and risk if skipped.

#### WS-3.7 — UI demo-risk fixes *(carry-overs from §9.4 item 6)*
- **Objective/Scope:** initial-load fetch error states on all four pages (no more silent "Loading…" on a dead backend); browser tab title/branding (`frontend/index.html`); remove leftover Vite template assets and rewrite `frontend/README.md`.
- **Acceptance criteria:** killing the backend and loading any page shows a human error message; tab reads "Shortlist"; no template remnants.

### 12.2 Dependency chain (summary)

```
Phase 1 (done) ─▶ WS-2.0 ─▶ { WS-2.1 ─▶ WS-2.2, WS-2.4, WS-2.11 }
                        ├─▶ WS-2.3 ─▶ WS-2.5
                        ├─▶ WS-2.6, WS-2.9, WS-2.12
                        └─▶ (WS-2.7, WS-2.8, WS-2.10 have no Phase 2 deps)
Phase 2 ─▶ Phase 3 (WS-3.1 … WS-3.7; WS-3.7 can start any time)
```

## 13. Cross-cutting concerns

### 13.1 Error handling

- **Never-raise extraction:** `extract_text` returns `(text | None, error | None)`; every failure becomes `needs_manual_review`, never an exception or a dropped candidate (`pipeline/extract.py`).
- **LLM failures:** one retry inside `call_structured`; then `LLMCallError` + `AuditEvent(kind="model_call_failed")`; callers set `needs_manual_review` (`pipeline/parse.py`, `pipeline/run.py`).
- **Per-candidate isolation:** one candidate's failure never aborts a screening run (`pipeline/run.py`).
- **API conventions:** 404 unknown resource; 409 wrong state (intake finalized, missing rubric); 422 invalid action. Background screening errors surface via application statuses, not HTTP.
- **Frontend:** user-triggered actions surface errors in red banners; **initial-load fetches currently don't** — known gap, WS-3.7.

### 13.2 Logging & audit

The audit trail **is** the logging strategy: every model call (success or failure) and every human decision writes an `AuditEvent` (§8). Append-only by convention — no code path updates or deletes audit rows; keep it that way (deletion semantics: WS-2.10). Payload inputs truncated at 2,000 chars/variable. There is no separate application logger today; if one is added, it must not become a second, unaudited record of candidate-affecting behaviour.

### 13.3 LLM conventions (binding on all future model work)

1. All model calls go through `call_structured()` (`backend/shortlist/llm/client.py`). No direct SDK use anywhere else.
2. Structured outputs only — Pydantic `response_format`, no hand-parsed JSON.
3. No sampling parameters (`temperature`/`top_p`) — D-8, F3.4.
4. Prompts live in the versioned registry (`llm/prompts.py`), never inline; version bumps on any change; scoring prompts additionally gated by the golden set (WS-2.6).
5. Model choice comes from `STAGE_MODELS` config, never hardcoded in a stage.
6. Keep the system prompt first and byte-identical across a scoring run (automatic prefix caching); per-candidate content after it.
7. Resume text is untrusted: `<resume>`-delimited, user-message only, never in system prompts (WS-2.9 hardens further).

### 13.4 Product invariants (every phase, no exceptions)

1. No candidate is rejected, ranked out, or advanced without an explicit human action; no bulk actions exist (F4.2, D-5).
2. Must-have failure ≠ rejection — visible "did not meet stated requirements" section only (F3.3).
3. Every AI output and human decision lands in the append-only audit trail (F4.3).
4. Compliance outputs cite the corpus or refuse with a fairwork.gov.au link — never improvised legal guidance (F6.1); always the general-information disclaimer (F6.2).
5. Award pointers name awards only — never rates or classifications (§3).
6. Failures surface as `needs_manual_review` — never a silent zero (§7).
7. Scoring sees only the redacted resume; identity is revealed only at human review (F3.1/F4.1).

### 13.5 Security & privacy posture

- Secrets in `backend/.env` (gitignored; `backend/.env.example` is the template). Never commit keys.
- **Synthetic data only until a pilot is agreed** — no real candidate PII in the repo, fixtures, tests, or local DBs.
- No auth, single tenant, local-only: acceptable for the POC, documented as pilot gaps (WS-3.6). Encryption/deletion/retention arrive in WS-2.10.
- Prompt-injection posture per §13.3(7) and WS-2.9.

### 13.6 Testing strategy & conventions

- pytest in `backend/tests/`; **the offline suite never touches the network** — `fake_llm` (in `conftest.py`) mimics the OpenAI parse response shape and asserts queue/schema agreement; `api_client` runs the full FastAPI app against in-memory SQLite.
- Live-API tests (WS-2.0 smoke, WS-2.5 harness, WS-2.6 golden set) are explicitly marked and skipped without a key; their cost is documented.
- Each phase's definition-of-done is executable — acceptance criteria become tests wherever possible.
- Frontend has no test suite (accepted POC gap; revisit only if pilot).
- Windows is the dev machine: cross-platform tooling only in scripts (WS-3.4).
- Commit style: conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`) as in the existing history. Docs governance per `CLAUDE.md`: README current after every major task; major decisions appended to `DECISIONS.md`; handover per phase in `docs/handover/`.

## 14. Open questions

The single consolidated list of genuinely undecided items. Nothing here is silently assumed elsewhere in this document; sections above mark their gaps with these IDs.

| ID | Question | Context / where it bites | Decide by |
|---|---|---|---|
| **OQ-1** | Does the hosted candidate application form (F2.1: upload, work-rights self-declaration, screening questions) get built before a pilot, or does the pilot also run on operator-loaded resumes? Currently **unscheduled** — no roadmap phase includes it. | F2.1, §5 step 3, WS-2.10 (upload path encryption), WS-3.6 (abuse protection) | Before pilot commitment; latest at Phase 3 planning |
| **OQ-2** | Should that form include an optional voluntary EEO-style question set, or is that over-engineering for small business? | Depends on OQ-1 | With OQ-1 |
| **OQ-3** | Interview kit delivery: in-app only, or also printable one-pager (F5.4) / email / PDF? F5.4 is currently unbuilt with no workstream. | F5.4, WS-3.2 demo polish | Phase 3 planning |
| **OQ-4** | Post-interview stage (structured note capture against the rubric) as a future phase — natural extension, risks stalling the core. | Roadmap scope | After Phase 3 |
| **OQ-5** | Scanned/image-only PDFs: implement a vision-model fallback, or amend the design spec and keep `needs_manual_review`? (Design spec promised a native-PDF fallback; Phase 1 shipped the flag.) | F2.2, WS-2.12(6) | WS-2.12 |
| **OQ-6** | JD tone configurability (friendly/professional, F1.2): build the toggle or formally reduce the requirement to friendly-only? | F1.2 divergence | Phase 2 or 3 planning |
| **OQ-7** | All-questions-blocked kit semantics: rewrite-in-place, drop-and-regenerate, or persist an empty kit with reasons? | WS-2.4 design; latent defect §9.4(1) | WS-2.4 design session |
| **OQ-8** | Phase 3 deploy: local-only demo or temporary hosted instance for client hands-on? | WS-3.5 | Phase 3 planning, with the client |
| **OQ-9** | Audit export: is JSON sufficient, or is PDF worth building (stretch)? | WS-2.8 | WS-2.8 design session |

## 15. Glossary

| Term | Meaning here |
|---|---|
| **Award / modern award** | An Australian industrial instrument setting minimum pay/conditions per industry. This product only ever **names** a likely award (F1.5) — never computes rates (§3). |
| **AHRC** | Australian Human Rights Commission — source of anti-discrimination guidance for the grounding corpus. |
| **Bias harness** | The matched-pair test suite (F3.5, WS-2.5) asserting score parity across identity variations; the portfolio centrepiece. |
| **Code-orchestrated pipeline** | The core architecture (D-2): code sequences the stages; the model never chooses the next step. Opposite of an agent loop. |
| **Criterion — `must_have` / `weighted`** | Rubric entry types: must-haves are pass/fail and never auto-reject (F3.3); weighted criteria score 0–5 and combine into the overall weighted average. |
| **D-n / F-n.n / OQ-n / WS-x.y** | Stable identifiers: decisions (§11), functional requirements (§6), open questions (§14), phase workstreams (§12). |
| **DecisionEvent** | A human action (shortlist/hold/reject + note) — the only mechanism that changes a candidate's fate. |
| **Evidence guidance** | Per-criterion rubric text telling the scorer what would count as meeting the criterion in a resume. |
| **FWO** | Fair Work Ombudsman (fairwork.gov.au / 13 13 94) — the referral target for everything the system won't answer itself. |
| **Golden set** | Frozen resumes + rubric pinned to prompt versions, used by the scoring-consistency regression (WS-2.6). |
| **Grounding corpus** | The curated store of NES/FWO/AHRC guidance (F6.1) behind every compliance output — cite or refuse. |
| **Guardrail slot** | A protocol-typed insertion point (`guardrails/base.py`) — redaction, JD lint, question filter — whose implementation can be swapped without touching pipeline stages. |
| **Honest stub** | A Phase 1 slot implementation that does nothing but says so (`implemented=False`), surfaced in the UI (D-7). |
| **Identity-blind** | The property that scoring sees only the redacted resume; identity is revealed only at human review (F3.1/F4.1). |
| **Intake** | The bounded (≤5 question, code-enforced) Q&A that turns Sam's plain-language description into a `RoleBrief`. |
| **Interview kit** | Per-candidate question set (behavioural / candidate-specific / practical) with listen-fors, post-filter (F5). |
| **JD** | Job description — the generated ad (F1.2). |
| **Listen-for** | The note on each kit question tying it back to a rubric criterion (F5.2). |
| **Matched pair** | Two resumes identical except for identity signals (name/gender/age) — the bias harness's unit of measurement. |
| **needs_manual_review** | Application status meaning "the system could not process this fairly — a human must look"; never a silent zero (§7). |
| **NES** | National Employment Standards — baseline entitlements; corpus document. |
| **Nudge, don't block** | F4.4: out-of-band decisions prompt for an optional reason but are never prevented. |
| **Prompt registry** | `llm/prompts.py`: versioned, frozen prompts; the unit of change control for model behaviour. |
| **Redaction** | Masking identity signals from resume text before scoring (F3.1). |
| **RoleBrief** | Structured intake output: title, employment type, hours, location, must/nice-to-have skills, experience band. |
| **Rubric** | The weighted-criteria scoring contract generated with the JD (F1.3); the contract for all downstream stages. |
| **Sam** | The primary persona: small-business owner-operator (§4). |
| **Screening run** | One pass of parse → redact → score across a job's applications (`pipeline/run.py::screen_job`). |
| **Shortlist** | (Product name) the app; (verb) Sam's positive decision on a candidate. |
| **Stage** | One typed pipeline function wrapping at most one focused model call (`backend/shortlist/pipeline/`). |
| **Structured outputs / strict mode** | Provider-enforced JSON-schema conformance: OpenAI `beta.chat.completions.parse` with a Pydantic `response_format` (D-8). |
