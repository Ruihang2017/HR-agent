# PRD — Jobpin: Local-First Hiring Workbench for the Boss

| | |
|---|---|
| **Working name** | Jobpin (local hiring assistant) |
| **Version** | 2.7 — Canonical |
| **Date** | 9 July 2026 |
| **Owner** | Horace Hou |
| **Provenance** | Derived in full from the client technical spec (2026-07-09 meeting), preserved verbatim at `docs/meeting_minutes/2026-07-09-jobpin-technical-spec.md` (D-8). **This PRD is the single source of truth**; new client input arrives as new minutes and is applied here by explicit update. |
| **Status** | Pre-implementation — the repository was reset on 2026-07-09; no product code exists yet |

**Version history**
| Version | Date | Change |
|---|---|---|
| 0.1 / 1.0 | 2026-07-06/09 | The former **Shortlist** product (Australian small-business web POC on a cloud LLM API). Superseded in full; recoverable at git commit `db5e511`. |
| 2.0 | 2026-07-09 | Project reset. New PRD derived from the client's technical spec (now archived as meeting minutes — D-8). All identifiers (F-, D-, OQ-, Phase numbers) restart; v1.x identifiers are dead. |
| 2.1 | 2026-07-09 | Owner decisions applied: English-first product language (D-7); client spec archived as meeting minutes, PRD restored as single source of truth (D-8); OQ-5 resolved. |
| 2.2 | 2026-07-09 | Model-layer correction (D-9): the minutes' "local Hermes model" was a transcription error — AI runs on cloud model APIs (OpenAI / DeepSeek / Anthropic Claude) behind a switchable gateway; the app and all data remain local. Resolves OQ-1/OQ-3. |
| 2.3 | 2026-07-09 | Model access is subscription-based, Cursor-style — no user API keys, in-app model catalog (D-10); free provider choice with in-app risk disclosure + liability disclaimer (D-11). Resolves OQ-10/OQ-11. |
| 2.4 | 2026-07-09 | Subscription delivery: **token issuance** — the app calls providers directly, candidate content never transits vendor infrastructure (D-12; vendor proxy rejected, kept as free-tier fallback). Plans: Free (limited tokens, 1 month) + Pro (A$20/month) (D-13). |
| 2.5 | 2026-07-09 | OS targets decided (D-14): cross-platform-safe Electron codebase, **Windows-only shipping for MVP**, macOS post-MVP on demand, Linux out of scope. |
| 2.6 | 2026-07-09 | Scope close-out (D-15–D-19): Gmail integration and Jobpin-platform integration become **non-goals**; AU-first developer-supplied lawyer-reviewed templates homed at `templates/au/`; encryption scoped to candidate data only; onboarding-document generation moved to immediately-post-MVP. **No open questions remain.** |
| 2.7 | 2026-07-09 | Cleanup (D-20): decision log moved to `DECISIONS.md`; Open-questions and Glossary sections removed (all questions resolved — resolutions recorded in `DECISIONS.md`); all section symbols replaced with plain "section N" references; DB key fields rendered as a code block. Sections renumbered: Implementation plan is now 10, Cross-cutting concerns is 11. |

## How to use this document

- **This PRD is the source of truth** (per `CLAUDE.md`). It was derived in full from the client technical spec of 2026-07-09, preserved verbatim as archived meeting minutes at `docs/meeting_minutes/2026-07-09-jobpin-technical-spec.md`. Citations like *[spec 4.3]* point at numbered sections of that archived document (Chinese). Future client meetings produce new minutes under `docs/meeting_minutes/`, which are applied to this PRD by explicit update — **minutes are input; the PRD is truth.** If code and PRD disagree, raise the conflict, don't silently patch.
- Do not modify this PRD unless the user explicitly asks (`CLAUDE.md` rule 1).
- Stable identifiers: functional requirements `F<n>.<m>` and `Phase 0…5` live in this PRD; decision IDs `D-<n>` resolve in **`DECISIONS.md`** (decision index + dated entries). Historical open questions were tracked as `OQ-<n>` — all are resolved; the resolutions are recorded in `DECISIONS.md`.
- Companion documents: `DECISIONS.md` (decision index + dated log — the home of all D-numbers), `docs/handover/` (one handover per major unit of work), `docs/meeting_minutes/` (archived client meeting outcomes), `templates/` (developer-supplied AU template content), `README.md` (how to run — currently "nothing to run yet").

---

## 1. Overview

### Problem

A small-business boss who hires occasionally has no HR department and no tooling between "resumes in my inbox" and "someone starts on Monday." Cloud ATS/SaaS products are built for HR teams, demand accounts and subscriptions, and put candidate data on other people's servers.

### Product

**Jobpin is a boss-only hiring workbench that runs on the boss's own computer** — the app, the database, and every file live locally; AI analysis calls out to a configurable cloud model API (D-9). *[spec 1, 10]*

There is exactly **one role: the boss**. No HR role, no admin role, no multi-tenancy, no permission matrix, no cloud backend for hiring data (the only vendor-side service is subscription auth/metering — D-10). *[spec 1]*

Core capabilities *[spec 1]*:
- Manage all hiring material for a job in one per-job workspace.
- Analyse how well each candidate's resume matches the job's JD.
- Generate interview questions, record interviews, and assist ranking.
- Accumulate the boss's preferences, company memory, and per-job experience over time.
- Generate invitation emails, onboarding emails, legal documents, and onboarding documents.
- Keep all data permanently on the local machine.

The system has **no relationship to the external Jobpin platform** — integration of any kind (plugin, import/export bridge, sync layer) is a non-goal (D-18; the minutes' future-integration note *[spec 1]* is deliberately descoped).

### Product stance *[spec 10]*

"The boss's local hiring workbench, not a SaaS HR platform." The seven boundaries below are product law:

1. **The boss decides; the AI ranks.**
2. **Local data; no cloud storage of hiring data.** All hiring data persists locally. External touchpoints: the configured model API for AI features (D-9); the vendor subscription service for plan auth and token issuance — candidate content never transits it (D-10, D-12). Nothing else — email is templates-only, with no mailbox integration (D-15).
3. **Job-centric, not org-chart-centric.**
4. **Memories are isolated per scope and traceable.**
5. **Legal documents can be generated but must be human-reviewed.**
6. **The AI may learn the boss's preferences — never discriminatory ones.**
7. **Every conclusion about a candidate must carry an evidence source.**

## 2. Goals & success criteria

The MVP is done when the following full journey works **on one machine with all data persisted locally** — AI steps call the configured model API (D-9); email is templates-only (D-15) *[spec 9]*:

> Create a job (folder + JD) → import resumes (upload / paste) → AI analyses each candidate and produces a ranked list with an immutable ranking snapshot → generate interview questions → record an interview manually → post-interview re-ranking (new snapshot) → generate invitation and onboarding email templates → everything persisted in SQLite + local files under `jobpin-data/`.

Concretely, the MVP ships *[spec 9, first list]*: local Electron app · single boss role · job folder creation · JD upload · resume upload · AI candidate analysis · candidate ranking · interview question generation · manual interview records · post-interview re-ranking · invitation email template generation · onboarding email template generation · SQLite persistence · permanent local file storage.

Success beyond function: every AI conclusion in that journey shows its **evidence source and confidence** (section 7), every ranking is **explainable from its snapshot** (F4), and nothing was decided or sent without the boss's explicit action (section 11.1 invariants).

## 3. Non-goals (MVP)

Explicitly **not** built in the first version *[spec 9, second list]*:

- Multi-user permissions.
- Cloud sync.
- Enterprise backend.
- ATS integration.
- Auto-sending offers.
- Auto-rejecting candidates.
- Automated legal judgment.
- Video interview analysis.
- Large-scale hiring pipelines.
- Tight coupling to the Jobpin platform.
- **Email-service integration (Gmail MCP/API)** — the product generates email *templates* only; the boss sends from their own mail client. The minutes' optional-Gmail lines *[spec 2, 4.2]* are deliberately descoped (D-15).
- **Jobpin-platform integration of any kind** — no plugin, import/export bridge, or sync layer (D-18).

Additional standing boundaries: no protected attributes, zodiac (星座), bazi (八字), or MBTI as ranking/decision inputs, ever — see F3.4 and section 11.1; this is a permanent rule, not an MVP deferral *[spec 4.2, 8]*.

## 4. Target user

**The boss** — a small-business owner-operator who hires occasionally, reads resumes personally, interviews personally, and decides personally. Works from their own computer; wants candidate data on that computer and nowhere else. Not an HR professional; wants judgment support, not process bureaucracy. There is no secondary user: candidates never touch the system (resumes arrive by upload or paste). *[spec 1, 10]*

## 5. Core user journeys *[spec 4]*

### 5.1 Create a job *[spec 4.1]*
The boss inputs or uploads: job name, JD, company values, a job-specific *inject* (AI context), legal document templates, and interview preferences. The system generates: the job folder (per the section 8.2 layout), an initial question bank, scoring dimensions, a candidate-analysis template, and email templates.

### 5.2 Import candidates *[spec 4.2]*
Sources: manual resume upload; paste of resume text. (The minutes' optional Gmail auto-fetch is descoped — non-goal, D-15.) Processing pipeline: ① save the original file → ② extract text → ③ analyse against JD + company values + job inject → ④ produce an initial score → ⑤ insert into the ranked candidate list.

### 5.3 AI ranking *[spec 4.3]*
Ranking uses **job-relevant factors only**:

```
total score = JD fit + key skills + relevant experience + growth trajectory
            + interview performance + boss-preference match
```

**Every ranking run is saved as an immutable snapshot** (id, job, timestamp, criteria, per-candidate rank/score/reason) so that: the ranking can be explained later exactly as it stood; candidate movement can be compared across time; and divergence between the AI's suggestion and the boss's final decision can be tracked.

### 5.4 Invite to interview *[spec 4.4]*
After the boss selects a candidate, the system generates emails from local templates: online interview invitation, onsite invitation, reschedule, rejection, and request-for-more-materials. **The product never sends email — it generates templates only (D-15)**; the boss copies them into their own mail client. This structurally satisfies the spec's human-confirm-before-send rule *[spec 8]*.

### 5.5 First-round interview *[spec 4.5]*
- **Entry modes:** manual note entry (MVP); voice via STT and optional TTS question read-out (post-MVP, D-6).
- **Before:** the system generates standard questions, resume-specific questions, JD-risk-point questions, the boss's favourite questions, and follow-up suggestions.
- **During:** record question, answer, boss's manual notes, AI analysis, confidence, and whether the item affects ranking.
- **After:** the system outputs an interview summary, soft-skill observations, stability inference, risk points, recommended follow-ups, a next-round recommendation, and a **re-ranking** (new snapshot).
- **Epistemic principles** *[spec 4.5]*: the boss's manual input is a signal source, **not absolute gold truth**; STT transcripts and AI analyses are not final facts either; **every conclusion records its source and confidence.**

## 6. Functional requirements

Numbering is fresh for v2.0 (the v1.x F-numbers are dead). Each requirement cites its spec basis.

### F1 — Job workspace

- **F1.1** Create a job with name + JD; the system creates the per-job folder structure of section 8.2 under `jobpin-data/jobs/{job name}/`, named after the job. *[spec 3, 4.1, 11 tasks 4–5]*
- **F1.2** Job assets are file-first and boss-editable: `jd.md`, `inject.md` (job-specific AI injection context), `references/` (interview rules, legal notes, company context), `question_bank.json`, `learned_skills.md`. *[spec 3]*
- **F1.3** On job creation the system generates: initial question bank, scoring dimensions, candidate-analysis template, and email templates. *[spec 4.1]*
- **F1.4** Company-level assets live once, outside jobs: `company/company_memory.md`, `values.md`, `boss_preferences.json`, `legal_templates/`, `onboarding_templates/`. *[spec 3]*

### F2 — Candidate intake

- **F2.1** Manual resume upload (file) and manual paste (text) create a candidate under the job with the original preserved verbatim. *[spec 4.2, 9]*
- **F2.2** Text extraction from uploaded files into `resume_text.md`; extraction failure never destroys the original and is surfaced to the boss. *[spec 3, 4.2]*
- **F2.3** **Descoped — non-goal (D-15).** The minutes' optional Gmail MCP/API intake *[spec 2, 4.2]* is deliberately not built; candidate intake is manual upload/paste (F2.1) only. Revisit only on explicit owner re-scope.
- **F2.4** Every candidate gets a per-candidate folder (`profile.json`, original resume, `resume_text.md`, `ai_analysis.json`, `interviews/`, `emails/`, `documents/`). *[spec 3]*

### F3 — AI candidate analysis

- **F3.1** Analysis runs against JD + company values + job inject and produces, per candidate *[spec 4.2]*: JD fit · must-have skills · bonus skills · career continuity · growth trajectory · communication style · soft-skill evidence · risk points · recommended interview questions · AI-recommended rank.
- **F3.2** Every analysis is persisted (`ai_analysis.json` + `ai_analyses` table) with **provider, model, prompt version, timestamp, input materials, and reasoning**, so any past conclusion can be reconstructed. *[spec 8; provider/model per D-9]*
- **F3.3** Every conclusion carries an **evidence source and a confidence level**. No naked verdicts. *[spec 4.5, 8, 10]*
- **F3.4** Sensitive attributes (age, gender, race, religion, marital/fertility status, disability, nationality) are **never used** in analysis or ranking. If sensitive information appears in the input, the system only marks it **"must not be used for decisions."** Zodiac / bazi / MBTI are not decision inputs; they may exist only as boss-entered side notes explicitly labelled non-decisional. *[spec 4.2, 8]*
- **F3.5** The AI is an adviser, never the decider: analysis output is a recommendation; candidate status changes only by the boss's action. *[spec 8, 10]*

### F4 — Ranking

- **F4.1** Ranked candidate list per job, computed from job-relevant factors only, per the section 5.3 formula. *[spec 4.3]*
- **F4.2** **Ranking snapshots are mandatory and immutable**: every ranking run persists `{ranking_id, job, created_at, criteria, result[{candidate_id, rank, score, reason}]}` (tables `rankings` + `ranking_items`). Snapshots are never edited or deleted by the application. *[spec 4.3]*
- **F4.3** Per-candidate `reason` in every snapshot makes each rank explainable in one sentence or more. *[spec 4.3, 8]*
- **F4.4** The boss's final decision is recorded **separately** from the AI's recommendation, so AI-vs-boss divergence is trackable over time. *[spec 4.3, 8]*
- **F4.5** Post-interview re-ranking produces a **new** snapshot; history is preserved. *[spec 4.5, 9]*

### F5 — Interview support

- **F5.1** Pre-interview question generation: standard + resume-specific + JD-risk + boss-favourite questions + follow-up suggestions, drawing on `question_bank.json` and `learned_skills.md`. *[spec 4.5, 6]*
- **F5.2** The question bank must avoid unlawful or high-risk questions. *[spec 8]*
- **F5.3** Interview recording (MVP: manual entry): per item — question, answer, boss note, AI analysis, confidence, affects-ranking flag. Stored under the candidate's `interviews/` folder plus the `interviews`/`interview_questions`/`interview_answers` tables. *[spec 4.5, 7, 9]*
- **F5.4** Post-interview outputs: summary, soft-skill observations, stability inference, risks, recommended follow-ups, next-round recommendation, re-ranking trigger. *[spec 4.5]*
- **F5.5** *(Post-MVP)* Voice: STT for interview capture, optional TTS to read questions aloud. *[spec 2, 4.5; D-6]*

### F6 — Communications & documents

- **F6.1** Email template generation from local templates: online/onsite invitations, reschedule, rejection, more-materials, onboarding. The product generates **templates only — it never sends email** (D-15); the boss sends from their own mail client, which structurally satisfies the confirm-before-send rule. *[spec 4.4, 8, 9]*
- **F6.2** *(Immediately post-MVP — D-19)* Onboarding document generation from `onboarding_templates/`; first backlog item after the MVP ships. *[spec 1, 11 task 13]*
- **F6.3** *(Post-MVP)* Legal document generation (offer, contract) from `legal_templates/`; every template carries a **version and jurisdiction tag** (AU-first — D-16); template content is **developer-supplied and lawyer-reviewed**, homed in the repo at `templates/au/legal/` and bundled as app defaults (D-16); every generated offer/contract/onboarding document requires **human review** before use. *[spec 8]*
- **F6.4** Rendering via a template engine (Handlebars or Markdown → PDF/DOCX — engine choice is a Phase 4 design decision). *[spec 2]*

### F7 — Memory & skills accumulation

- **F7.1** Three memory scopes, **isolated from each other** *[spec 5]*:
  - **Company memory** (`company/company_memory.md`): values, long-term boss preferences, profiles of employees who worked out, risk patterns that didn't fit, interview lessons, legal notes.
  - **Job memory** (`jobs/{job}/learned_skills.md`): effective questions for this job, boss-favourite questions, common candidate risks, job-specific judgment criteria, lessons inferred from past hiring outcomes.
  - **Candidate memory** (`candidates/{id}/profile.json`): resume, AI analysis, interview records, email records, ranking history, final decision.
- **F7.2** **Propose → approve → write.** After an interview the AI may *propose* job-memory updates; nothing is written to `learned_skills.md` until the boss confirms; confirmed updates are referenced by the next question-bank generation. Memory writes are recorded as `memory_events` rows with `approved_by_boss`. *[spec 6, 7]*
- **F7.3** The AI may learn boss preferences (they are a ranking factor, section 5.3) but **must not learn discriminatory preferences** — proposals that encode protected attributes are refused/flagged, not stored. *[spec 10, 8]*

### F8 — Data protection & trust

- **F8.1** All candidate data lives permanently on the local machine — SQLite + `jobpin-data/` folders. The app persists nothing in any cloud. AI analysis sends the necessary candidate content to the configured model API at call time (stateless, D-9); the model-selection UI discloses this and the provider-choice risk, with a liability disclaimer in the terms (D-11). *[spec 1, 2, 10]*
- **F8.2** **Candidate data — and only candidate data — is encrypted at rest** (D-17): the `candidates/` trees and candidate-bearing DB content. Company/job files (JD, values, templates, question banks, learned skills) stay plain for file-first transparency (section 7). Mechanism (key management, file vs DB layer) is Phase 5 design. *[spec 8, 11 task 14]*
- **F8.3** Candidate data **deletion** is supported. *[spec 8]*
- **F8.4** Local **backup** (and restore) of the data set. *[spec 11 task 14; destination/format at Phase 5 design]*
- **F8.5** The LLM system prompt carries these hard constraints verbatim (translated from spec 8):
  > You are a hiring assistance system, not the final decision maker. You may only analyse based on job-relevant evidence. You must not use protected attributes or job-irrelevant personal characteristics in ranking. If the input contains sensitive information, you may only mark it "must not be used for decisions." Every conclusion must include its evidence source and confidence.
- **F8.6** Legal disclaimer: none of the system's legal-adjacent output is legal advice; before use in real hiring it must be reviewed by a local lawyer. *[spec 8]*

## 7. Non-functional requirements

- **Local-first data.** All persistence is local (SQLite + `jobpin-data/`); the app stores nothing in any cloud. Network touchpoints are transactional only: the configured model API for AI features (D-9) and subscription auth/token issuance (D-10, D-12); the app degrades gracefully offline — everything except AI analysis/generation still works (offline grace for subscription validation is a Phase 2 design item). *[spec 1, 2; model layer per D-9]*
- **Single-role simplicity.** One boss — no multi-user accounts, roles, or permission checks; the OS user session is the trust boundary (plus at-rest encryption, F8.2). The only sign-in is subscription activation for model access (D-10). *[spec 1]*
- **Explainability & auditability.** AI analyses versioned with inputs and reasoning (F3.2); rankings snapshotted immutably (F4.2); boss decisions recorded separately (F4.4). Reconstructing "why did it say that, then?" is a first-class requirement. *[spec 4.3, 8]*
- **Honesty under uncertainty.** Source + confidence on every conclusion; boss input, STT, and AI output are all treated as fallible signals. *[spec 4.5]*
- **Provider-agnostic AI.** All model calls go through one model-gateway abstraction with switchable providers — OpenAI, DeepSeek, Anthropic (Claude) (D-9). The boss never handles API keys: model access comes with the subscription, and the boss picks from the in-app model catalog their plan allows (D-10). No provider SDK outside the gateway; switching models must never touch feature code. Every analysis records the provider + model that produced it (F3.2).
- **File-first transparency.** The boss can open `jobpin-data/` and read/edit their material as plain files (Markdown/JSON); the DB indexes and relates, the folder is the substance. Candidate folders become the deliberate exception once Phase 5 encryption lands (D-17). *[spec 3]*

## 8. Data model *[spec 3, 7]*

### 8.1 SQLite (MVP)

Tables: `jobs, candidates, candidate_documents, interviews, interview_questions, interview_answers, ai_analyses, rankings, ranking_items, emails, memory_events, documents, settings`. SQLite is sufficient for the MVP.

Key fields as specified *[spec 7]*:

```txt
jobs:                 id, name, folder_path, jd_path, inject_path, created_at, updated_at

candidates:           id, job_id, name, email, phone, status, current_rank,
                      created_at, updated_at

candidate_documents:  id, candidate_id, type, file_path, extracted_text_path, created_at

interviews:           id, candidate_id, stage, mode, scheduled_at, transcript_path,
                      summary_path, ai_score, boss_decision, created_at

rankings:             id, job_id, reason, created_at

ranking_items:        id, ranking_id, candidate_id, rank, score, reason

memory_events:        id, scope, scope_id, source_type, source_id, content,
                      approved_by_boss, created_at
```

Fields for the remaining tables (`interview_questions`, `interview_answers`, `ai_analyses`, `emails`, `documents`, `settings`) are defined at Phase 0 design time within the spec's table list.

### 8.2 File layout *[spec 3]*

```
jobpin-data/
  company/
    company_memory.md
    values.md
    boss_preferences.json
    legal_templates/
    onboarding_templates/
  jobs/
    {Job Name}/                  # one folder per job, named after the job
      jd.md
      inject.md                  # job-specific AI injection context
      references/
        interview_rules.md
        legal_notes.md
        company_context.md
      question_bank.json
      learned_skills.md          # job memory (F7.1)
      candidates/
        {candidate_id}/
          profile.json           # candidate memory (F7.1)
          resume.pdf             # original, preserved verbatim
          resume_text.md         # extracted text
          ai_analysis.json
          interviews/            # e.g. 2026-07-08-round-1.json, -notes.md
          emails/
          documents/
```

DB rows reference file paths (`folder_path`, `jd_path`, `transcript_path`, …): **files are the substance, the DB is the index.**

## 9. Architecture *[spec 2]*

Distribution: a **local installer**. Runtime shape:

```
┌────────────────────────── boss's computer ──────────────────────────┐
│  Electron desktop app (UI: React — D-3)                             │
│        │ IPC/HTTP                                                   │
│  Node.js local server (localhost:<port>)                            │
│        ├── SQLite (index & relations)                               │
│        ├── jobpin-data/ file storage (substance)                    │
│        ├── Model gateway — provider-abstraction layer (D-9):        │
│        │     adapters for OpenAI / DeepSeek / Anthropic (Claude);   │
│        │     model catalog by subscription plan (D-10)              │
│        ├── Template engine (Handlebars / md→PDF/DOCX)               │
│        └── [post-MVP] Local STT / optional TTS                      │
└──────────────────────────────────────────────────────────────────────┘
     AI calls (stateless)      ⇄  configured model API
                                    (OpenAI / DeepSeek / Claude)
     subscription auth +       ⇄  vendor subscription service
       token issuance (D-12)        (candidate content never transits it)
```

MVP stack: Electron · React (D-3; spec allows React/Vue) · Node.js local server · SQLite · local file storage · **model gateway over cloud LLM APIs — OpenAI / DeepSeek / Anthropic Claude (D-9), subscription-based access (D-10)** · local STT (post-MVP) · Handlebars / Markdown→PDF/DOCX templating. *(The archived minutes' "local LLM runtime, Hermes modified build" was a minute-taking error — see D-9.)*

**No repository code exists yet** — the previous implementation (Python/FastAPI/React web app) was removed on 2026-07-09 and is unrelated to this architecture; see D-1.

## 10. Implementation plan

Phases group the spec's recommended build order (tasks 1–14, *[spec 11]*), each mapped `(task n)`. Every phase is a self-contained brief: a future design session should be able to start from its section alone. Decision IDs (D-n) resolve in `DECISIONS.md`. **No phase has started.**

### Phase 0 — Desktop foundation *(tasks 1–3)*

- **Objective:** a launchable local skeleton — the Electron shell, the embedded Node server, and the persistence substrate — so every later feature has a home.
- **Scope:** Electron app boot; local server on a localhost port; SQLite schema for all section 8.1 tables; `jobpin-data/` root + `company/` scaffold creation on first run. **Out:** any AI, any UI beyond a shell window.
- **Technical approach:** Electron + React (D-3) + Node local server in one installer-able project; schema migration mechanism chosen here; port selection/collision policy; decide remaining table fields (section 8.1) within the spec's table list.
- **Dependencies:** none.
- **Acceptance criteria:** fresh install → app opens; server responds on localhost; DB file exists with all 13 tables; `jobpin-data/company/` scaffold (empty templates) created; everything works offline.
- **Risks:** Windows-only packaging/signing per D-14, but keep the codebase cross-platform-safe (no Windows-only path or credential assumptions — use Electron's cross-platform APIs, e.g. `safeStorage`, for the D-12 tokens); installer tooling choice (e.g. electron-builder) is made here.

### Phase 1 — Job workspace & candidate intake *(tasks 4–6)*

- **Objective:** the boss can create a job and get candidates into it — the non-AI backbone of F1/F2.
- **Scope:** job creation UI → folder generation per section 8.2 (F1.1–F1.4); JD upload/storage (`jd.md`); resume upload + paste; text extraction to `resume_text.md` (F2.1, F2.2, F2.4); candidate list (unranked). **Out:** analysis, ranking.
- **Technical approach:** file-first writes with DB index rows (`jobs`, `candidates`, `candidate_documents`); extraction library for PDF/DOCX chosen at design time; extraction failure keeps the original and marks the candidate for boss attention (F2.2).
- **Dependencies:** Phase 0.
- **Acceptance criteria:** create "Sales Manager" → exact section 8.2 folder tree exists; upload a PDF resume → original + extracted text stored, candidate visible; paste text → same; a corrupt file leaves the candidate present and flagged, never lost.
- **Risks:** job-name folders need filesystem-safe naming rules (unicode, duplicates) — design here; extraction quality for image PDFs (defer OCR — post-MVP unless trivially available).

### Phase 2 — AI analysis & ranking *(tasks 7–8)*

- **Objective:** the product's core intelligence: per-candidate analysis (F3) and snapshot-persisted ranking (F4), built on a provider-agnostic model gateway (D-9).
- **Scope:** the model-gateway module with provider adapters (OpenAI, DeepSeek, Anthropic Claude); model selection from the plan's catalog (D-13: Free / Pro tiers) + subscription activation in settings (`settings` table; token-issuance client per D-12, stubbed with dev credentials until the vendor service exists — a Phase 2 design item); the provider-risk disclosure at model selection (D-11); candidate analysis producing all F3.1 dimensions with evidence + confidence (F3.3) into `ai_analysis.json` + `ai_analyses`; sensitive-info flagging (F3.4); system-prompt hard constraints (F8.5); ranked list + immutable snapshots (F4.1–F4.3); section 5.3 scoring composition. **Out:** interview flows; boss-preference *learning* (Phase 3 — but `boss_preferences.json` may be read if present).
- **Technical approach:** the gateway is the single call site — every call logged into `ai_analyses` with provider, model, prompt version, inputs, and reasoning (F3.2); structured JSON outputs validated against schemas, with a per-provider structured-output strategy (native JSON/tool modes where available, validate-and-retry otherwise); ranking math in code — the LLM contributes component judgments and reasons, code composes the total (auditable arithmetic); no-network / auth-failure states degrade to a visible "analysis unavailable — retry" (section 11.2), never a fabricated score.
- **Dependencies:** Phase 1. Tiers/catalog are set (D-13); token-issuance mechanics are designed within this phase (see risks); the vendor service can be stubbed with dev credentials and does not gate the gateway build.
- **Acceptance criteria:** import 5 resumes → each gets a complete analysis (all F3.1 dimensions, each with evidence + confidence); **switching provider in settings re-routes the next analysis with zero feature-code changes**, and the analysis record shows the new provider + model; model selection shows the provider-risk disclosure (D-11); a resume containing age/marital status yields a "must not be used for decisions" flag and those attributes demonstrably don't move the score; ranking produces a snapshot row-for-row matching the spec 4.3 JSON shape; re-running ranking appends a new snapshot, never mutates the old; with the network unplugged, analysis shows the unavailable state and everything else keeps working.
- **Risks:** cross-provider output variance — the same prompts must yield schema-valid, comparable analyses on all three providers (a small cross-provider eval set is part of this phase); usage/quota visibility for the boss (allowances per D-13); token-issuance design items: per-provider key/budget APIs (DeepSeek's controls are the thinnest — confirm, or proxy DeepSeek only), key TTL/rotation, revocation on cancel, offline grace period, free-tier abuse controls, at-cap behaviour, exact per-tier allowances.

### Phase 3 — Interview loop & memory *(tasks 9–11)*

- **Objective:** close the hiring loop: prepare questions, record what happened, learn from it — with the boss approving every memory write.
- **Scope:** question generation (F5.1, F5.2) from JD + resume + `question_bank.json` + `learned_skills.md` + boss preferences; manual interview recording (F5.3); post-interview outputs + re-ranking (F5.4, F4.5); memory-update proposals with boss approval → `learned_skills.md` + `memory_events` (F7.2, F7.3). **Out:** STT/TTS (post-MVP).
- **Technical approach:** interview entities per section 8.1 (`interviews`, `interview_questions`, `interview_answers`) + `interviews/` files; per-item source + confidence recorded (spec 4.5 principles); proposal/approval UI for skills; discriminatory-preference proposals blocked at the gateway (F7.3).
- **Dependencies:** Phase 2.
- **Acceptance criteria:** generate a question set showing all five F5.1 categories; record a round with per-item boss notes + AI analysis + confidence; post-interview summary produced and a new ranking snapshot appears; an AI skill proposal only lands in `learned_skills.md` after explicit approval (and a rejected one is recorded as rejected in `memory_events`); a proposal encoding a protected attribute is refused with a visible reason.
- **Risks:** "affects-ranking" flag semantics (which interview items feed the interview-performance factor) need crisp design; memory quality — bad approved lessons compound, so proposals must show their evidence.

### Phase 4 — Communications *(task 12)*

- **Objective:** the paperwork half of the MVP: every email template the journey needs, generated locally — the product never sends email (D-15).
- **Scope:** email template generation for the full section 5.4 set (online/onsite invite, reschedule, rejection, more-materials) + onboarding email (F6.1); template engine decision + variable model (F6.4); default template content sourced from `templates/au/` (D-16); generated artifacts stored under the candidate's `emails/` folder and the `emails` table. **Out:** any email sending or mailbox integration (non-goal, D-15); onboarding *document* generation (immediately post-MVP, D-19); legal offer/contract generation (post-MVP, F6.3).
- **Dependencies:** Phase 1 (candidates/jobs exist); independent of Phases 2–3 except for personalisation inputs.
- **Acceptance criteria:** for a chosen candidate, each section 5.4 email type renders with correct job/candidate variables and is saved locally; the UI has no send capability anywhere.
- **Risks:** templates are English-first (D-7) with Australian business norms (D-16); PDF/DOCX rendering fidelity on Windows.

### Phase 5 — Data protection & backup *(task 14)*

- **Objective:** make "your data, on your machine, safe" true under inspection: encryption, deletion, backup.
- **Scope:** at-rest encryption of candidate data (F8.2); candidate-data deletion (F8.3); local backup/restore (F8.4). **Out:** cloud anything.
- **Technical approach:** scope is fixed by D-17 (candidate data only — `candidates/` trees + candidate-bearing DB content; company/job files stay plain). Remaining design at phase start: key derivation (boss passphrase vs OS keychain / Electron `safeStorage`), file-layer vs DB-field mechanics, backup destination/format; deletion semantics vs immutable ranking snapshots (a deleted candidate's snapshot rows — purge or anonymise) decided and recorded as a D-entry.
- **Dependencies:** Phases 0–4 (it protects whatever exists).
- **Acceptance criteria:** candidate files on disk unreadable without the key while company/job files remain plain and boss-editable (D-17); app works normally with encryption on; deleting a candidate removes their files + rows (per the decided snapshot policy) in one action; backup → wipe → restore round-trips the full data set.
- **Risks:** key-loss recovery story (boss forgets passphrase); backup destination choice.

### Post-MVP backlog *(not scheduled)*

**First in line (immediately post-MVP, D-19):** onboarding document generation from `onboarding_templates/` (F6.2 — spec task 13). Then: STT interview capture + TTS (F5.5) · legal document generation (offer/contract) from the AU lawyer-reviewed set in `templates/au/legal/` (F6.3, D-16) · multi-round interview depth. **Gmail and Jobpin-platform integration are non-goals** (D-15, D-18) — revisited only on explicit owner re-scope.

### Dependency chain

```
Phase 0 ─▶ Phase 1 ─▶ Phase 2 ─▶ Phase 3 ─▶ Phase 5
                └────▶ Phase 4 ──────────────┘
```

## 11. Cross-cutting concerns

### 11.1 Product invariants (every phase, no exceptions) *[spec 8, 10]*

1. **The AI never makes the final hiring decision** — it analyses and recommends; only the boss changes a candidate's fate, and the boss's decision is recorded separately from the AI's recommendation.
2. **Ranking is explainable and job-relevant only.** No protected attributes (age, gender, race, religion, marital/fertility, disability, nationality); no zodiac/bazi/MBTI in any decision path — at most boss-entered side notes explicitly labelled "not a decision basis."
3. **Sensitive info in inputs is flagged "must not be used for decisions"** — flag-and-exclude, not silent use (D-5).
4. **Every conclusion carries evidence source + confidence.**
5. **Every ranking run persists an immutable snapshot.**
6. **Memory writes require boss approval** (propose → approve → write), and discriminatory preferences are never learned.
7. **The product sends no email at all — templates only (D-15);** no offer/contract/onboarding document is used without human review.
8. **Candidate data persists only locally** — encrypted at rest, deletable; AI calls send only what the analysis needs, statelessly and **directly to the provider, never via vendor infrastructure** (D-9, D-12).
9. **The F8.5 system-prompt constraints ship verbatim in every LLM call.**

### 11.2 Error & uncertainty handling

- Extraction/analysis failures never lose the original artifact and never silently drop a candidate — the boss sees a flagged state.
- All signals (boss notes, STT later, AI output) carry source + confidence; conflicting signals coexist rather than overwrite (spec 4.5).
- Model-API failures (no network, invalid key, rate limits, malformed output) degrade to a visible "analysis unavailable — retry" state, never a fabricated score.

### 11.3 AI-layer conventions

- One model-gateway module; no direct model calls or provider-SDK imports from feature code. Providers (OpenAI, DeepSeek, Anthropic Claude) are adapters behind one interface; the boss selects models from the subscription catalog — no user-managed API keys (D-10); credentials come from the subscription layer and are never committed (D-9). Every call is persisted (`ai_analyses`) with provider, model, prompt version, timestamp, inputs, and reasoning (F3.2).
- Structured, schema-validated outputs; a per-provider structured-output strategy (native JSON/tool modes where available, validate-and-retry otherwise) is part of Phase 2 design.
- Prompts are versioned assets, not inline strings; `inject.md`, `references/`, and memory files are injected as clearly delimited context.
- Resume and email content is untrusted input: delimited, never merged into the system prompt (which carries the F8.5 constraints).

### 11.4 Testing & engineering conventions *(ours — the spec is silent on testing)*

- Each phase's acceptance criteria become executable tests where feasible; AI-dependent tests use a faked gateway offline plus a small live smoke suite.
- Windows is the dev machine and the only shipped/supported OS in MVP (D-14) — but keep code cross-platform-safe (no Windows-only path or credential assumptions) so macOS later is a packaging task, not a port.
- Conventional commits (`feat:`/`fix:`/`docs:`/`chore:`); docs governance per `CLAUDE.md` (README current after every major task, decisions to `DECISIONS.md`, handover per phase).
- Synthetic/dummy resumes only in the repo and tests — no real candidate PII.

### 11.5 Language

**English-first (D-7):** the product UI, templates, code, and all repo documentation are English. Chinese is the client-meeting language only — minutes in `docs/meeting_minutes/` may be Chinese; where a Chinese domain term matters (老板 boss, 置信度 confidence, 星座/八字 zodiac/bazi), this PRD carries it inline next to the English. Template content should respect Australian business norms (D-16); locale details are a Phase 4 design concern, not a language question.
