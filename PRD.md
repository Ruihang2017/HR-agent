# PRD — AI Hiring Assistant for Australian Small Business

| | |
|---|---|
| **Working name** | Shortlist (placeholder) |
| **Version** | 0.1 — Draft |
| **Date** | 6 July 2026 |
| **Owner** | [Your name] |
| **Status** | Practice / portfolio project — not a commercial product |

---

## 1. Overview

Small Australian businesses (roughly 1–20 employees) hire infrequently and have no HR function. When they do hire, the owner writes the job ad from scratch, wades through resumes manually, improvises interview questions, and — often without realising it — risks breaching anti-discrimination law in the ad wording or the interview itself.

This product is an AI agent that takes a business owner from "I need to hire someone" to "I'm sitting down to interview my top three candidates, with a prepared question set," while enforcing fairness and legal guardrails at every step where an AI hiring tool could otherwise cause harm.

**Explicit framing:** this is a skills-practice project. The market already contains well-funded incumbents (Employment Hero's Recruitment Agent, FairWork Mate, Sapia.ai). The goal is not to beat them; it is to build a complete, defensible agent pipeline that demonstrates sound engineering judgment — particularly around bias mitigation, human-in-the-loop design, and grounded (non-hallucinated) compliance guidance.

## 2. Goals

1. A working end-to-end demo: JD in → ranked shortlist + interview kit out, on a batch of real or synthetic resumes.
2. Every stage produces structured, inspectable output (rubrics, scores, rationales, audit events) — no opaque "the AI decided" steps.
3. Demonstrable bias mitigation: identity-blind screening that can be shown side-by-side against naive screening.
4. Demonstrable compliance guardrails: discriminatory-language linting on JDs, an unlawful-question filter on interview kits, and a human decision gate before any candidate outcome.
5. Clean enough architecture and documentation to serve as a portfolio piece for AI engineering roles.

## 3. Non-goals

- **Candidate sourcing / search.** No integration with Seek, LinkedIn, or Indeed candidate pools — that data sits behind enterprise partnerships and is out of reach for this project. Scope is inbound applications only.
- **Award interpretation engine.** No attempt to compute pay rates, classifications, penalty rates, or entitlements across the 122 modern awards. The system may surface a pointer ("this role likely falls under the General Retail Industry Award — check fairwork.gov.au") but never calculates or asserts rates.
- **Payroll, onboarding, contracts, or Employer-of-Record functions.**
- **Legal advice.** All compliance output is labelled general information. The system cites its sources (NES, FWO/AHRC guidance) and directs users to the Fair Work Ombudsman or a professional for decisions.
- **Automated hiring decisions.** The system never rejects, ranks-out, or advances a candidate without an explicit human action. This is a hard product constraint, not a v2 nicety (see §7).
- **Multi-tenant SaaS hardening.** Single-tenant demo quality is acceptable; note where production would differ.

## 4. Target user

**Primary persona — "Sam," owner-operator.** Runs a 6-person business (café, trade services, small agency). Hires maybe twice a year. No HR training. Time-poor; does admin at night. Doesn't know what a "position description rubric" is and doesn't want to. Vaguely anxious about "getting sued" but has never read the Fair Work website.

Secondary user (for demo purposes): the candidate, who interacts only with a simple application form.

## 5. End-to-end user journey

1. Sam describes the role in plain language ("I need a part-time barista, weekends, must be able to open the shop alone").
2. The agent interviews Sam briefly to fill gaps (hours, must-haves vs nice-to-haves, experience level), then generates a job description **and** a structured scoring rubric. It flags any risky wording in Sam's inputs before it reaches the ad.
3. Sam posts the JD wherever they like. Candidates apply via a hosted form (upload resume, short questions).
4. The agent parses each resume, produces a redacted (identity-blind) version, and scores it against the rubric with a written rationale.
5. Sam opens the review screen: ranked shortlist, scores, rationales, and the full original resume one click away. Sam decides who to interview. Every decision is Sam's click, and every click is logged.
6. For each candidate Sam selects, the agent generates a tailored interview kit: role-specific and resume-specific questions, plus a what-not-to-ask panel. Any question Sam adds manually is checked against the unlawful-question filter before it lands in the kit.

## 6. Functional requirements

### F1 — Job description generator

- **F1.1** Conversational intake: the agent asks targeted follow-up questions until it has role title, employment type (full-time / part-time / casual), hours pattern, location, must-have skills, nice-to-have skills, and experience band. Max ~5 questions; sensible defaults otherwise.
- **F1.2** Output A — the JD: plain-language job ad, structured sections (about the role, responsibilities, requirements, how to apply). Tone configurable (friendly / professional).
- **F1.3** Output B — the scoring rubric (the contract for all downstream stages): a JSON object of weighted criteria, each with a name, weight, type (`must_have` | `weighted`), and evidence guidance ("what would count as meeting this"). Must-haves are pass/fail; weighted criteria score 0–5.
- **F1.4** Discrimination linter: before the JD is finalised, scan Sam's inputs and the draft for language that risks direct or indirect discrimination — age-coded terms ("recent graduate," "digital native," "young and energetic"), gendered wording, unnecessary physical requirements, citizenship demands where work rights suffice. Each flag shows the phrase, the risk, and a suggested rewrite. Sam can accept or dismiss; dismissals are logged.
- **F1.5** Award pointer (informational only): suggest the likely applicable modern award by name with a link to fairwork.gov.au, wrapped in the standard general-information disclaimer. No rates, no classifications.

### F2 — Application intake & resume parsing

- **F2.1** Hosted application form per job: name, contact, work-rights self-declaration (yes/no, no visa detail requested), resume upload (PDF/DOCX), and up to 3 short screening questions derived from the rubric's must-haves.
- **F2.2** Resume parsing to a structured schema: work history (role, employer, duration), skills, certifications/licences, education. Parsing failures degrade gracefully — the raw text is retained and the candidate is flagged for manual review, never silently dropped.
- **F2.3** For demo mode: a seed script that loads a batch of synthetic resumes (varied quality, varied formats) so the pipeline can be exercised without live applicants.

### F3 — Identity-blind screening & scoring

- **F3.1** Redaction pass (deterministic where possible, model-assisted where not): before scoring, strip or mask name, pronouns/gendered terms, age and date of birth, graduation years, photo, suburb/address, nationality/ethnicity signals, and club/association memberships that proxy for protected attributes. The redacted document is what the scoring model sees.
- **F3.2** Scoring: evaluate the redacted resume against each rubric criterion. Output per criterion: met/not-met (must-haves) or 0–5 (weighted), plus a one-to-two-sentence evidence citation quoting the resume. Output overall: weighted score and a short plain-language rationale.
- **F3.3** Must-have failures do not auto-reject. They place the candidate in a "did not meet stated requirements" section of the review screen, visible and one click from full detail. Only Sam moves anyone to rejected.
- **F3.4** Consistency requirement: scoring the same resume against the same rubric twice must produce the same must-have outcomes and weighted scores within ±0.5. (Achieve via low temperature, structured output schema, and criterion-by-criterion prompting rather than one holistic call.)
- **F3.5** Bias check harness (portfolio centrepiece): a test suite that runs matched resume pairs — identical content, different names/genders/ages — through the full pipeline and asserts score parity. Ship the harness and its results in the repo.

### F4 — Ranked shortlist & owner review

- **F4.1** Review screen: candidates ranked by score, each row showing score, rubric breakdown, rationale, and links to both the redacted and original resume. Identity is revealed only at this human-review stage.
- **F4.2** Sam's available actions per candidate: shortlist for interview, hold, reject. Each action optionally takes a note. **There is no bulk auto-action and no system-initiated rejection.**
- **F4.3** Audit log: every AI output (rubric, scores, flags) and every human action (with timestamp and note) is persisted per job. Exportable as a single JSON/PDF record.
- **F4.4** Nudge, don't block: if Sam rejects a top-scored candidate or shortlists a bottom-scored one, the UI asks for an optional reason. It never prevents the action — the human is the decision-maker, full stop.

### F5 — Interview kit generator

- **F5.1** Per shortlisted candidate: 8–12 questions grouped as role-based behavioural questions (from the rubric), candidate-specific probes (from gaps or notable items in their actual resume), and practical/scenario questions where the role suits it.
- **F5.2** Each question carries a "listen for" note tied to a rubric criterion, so Sam can take structured notes.
- **F5.3** Unlawful-question filter: every generated question, and every question Sam writes into the kit manually, is checked against the prohibited categories (age, marital/family status, pregnancy or family plans, religion, national origin/ethnicity, disability or health matters not directly relevant to inherent role requirements, union membership, sexual orientation). Blocked questions show the reason and, where a lawful underlying concern exists, a compliant rewrite ("Are you an Australian citizen?" → "Do you have the right to work in Australia?").
- **F5.4** A printable one-pager per candidate: questions, listen-fors, and a short "don't ask" reminder panel.

### F6 — Compliance layer (cross-cutting)

- **F6.1** Grounding corpus: a small curated RAG store containing the NES summary, FWO and AHRC guidance on discrimination in recruitment and unlawful interview questions, and the FWO's guidance on job ads. Every compliance-flavoured output (linter flags, filter blocks, award pointers) must cite which corpus document it draws from. If the corpus doesn't cover a question, the system says so and links to fairwork.gov.au rather than improvising.
- **F6.2** Disclaimer policy: all compliance outputs carry a consistent "general information, not legal advice" label with a link to the Fair Work Ombudsman (13 13 94 / fairwork.gov.au).
- **F6.3** Alignment with regulator expectations: the design assumes Fair Work's position that AI may assist but not solely determine hiring decisions — hence F3.3, F4.2, and the audit log in F4.3 are treated as invariants, not features.

## 7. Non-functional requirements

- **Privacy.** Resumes are personal information. Even where a small business is exempt from parts of the Privacy Act, the system behaves as if it isn't: candidate data is stored encrypted at rest, retained per-job with a configurable window (default 6 months post-close), deletable on request via a single action, and never used to train anything. The application form states what happens to the data.
- **Auditability.** Every model call that affects a candidate outcome logs its inputs (redacted), outputs, model version, and prompt version. Reproducibility of a decision trail matters more here than latency.
- **Determinism where it counts.** Redaction rules and the unlawful-question category list are code/config, not model vibes. The model interprets; the rules decide.
- **Cost envelope.** Design for a cheap default model on parsing/redaction and a stronger model on scoring and generation (implemented on OpenAI: `gpt-4o-mini` for parse/redact, `gpt-4o` for intake, JD/rubric, scoring, kits, and guardrail reasoning); a 50-resume screening run should cost cents, not dollars.
- **Honesty in failure.** Parsing or scoring failures surface as "needs manual review," never as a silent zero score.

## 8. Data model (sketch)

`Job` (title, JD text, status) → has one `Rubric` (criteria[], weights, version) → has many `Application` (candidate contact, original file, parsed schema, redacted text) → each has one `ScoreReport` (per-criterion results, overall, rationale, model+prompt versions) → each has many `DecisionEvent` (actor, action, note, timestamp) → `Job` has many `InterviewKit` (candidate ref, questions[], filter results). `AuditEvent` is the append-only union of all model outputs and decision events.

## 9. Milestones

| Phase | Deliverable | Definition of done |
|---|---|---|
| 1 | JD generator + rubric + discrimination linter | Plain-language input → JD + valid rubric JSON; linter catches a seeded set of risky phrases |
| 2 | Intake, parsing, redaction, scoring | 50 synthetic resumes → consistent scores with evidence citations; bias harness passes on matched pairs |
| 3 | Review screen + audit log | Sam can shortlist/hold/reject with full trail; exportable job record |
| 4 | Interview kit + unlawful-question filter | Tailored kits per candidate; filter blocks the standard prohibited categories including manually added questions |
| 5 | Polish + write-up | README with architecture diagram, bias-harness results, and honest limitations section |

## 10. Risks & mitigations

- **Hallucinated compliance claims** — the highest-severity failure. Mitigation: F6.1 grounding-with-citation requirement; refuse rather than improvise outside the corpus.
- **Scoring inconsistency undermines trust.** Mitigation: F3.4 structured per-criterion scoring, low temperature, regression tests on a fixed resume set.
- **Redaction misses a proxy variable** (e.g., a suburb or school name that signals ethnicity or class). Mitigation: layered redaction (regex + NER + model pass), plus the bias harness as the detector of last resort.
- **Scope creep toward FairWork Mate.** Mitigation: §3 non-goals are load-bearing; award interpretation stays a pointer, never a calculation.
- **Demo cold-start (no real applicants).** Mitigation: F2.3 synthetic resume seeder is a phase-2 deliverable, not an afterthought.

## 11. Open questions

1. Stack: **decided.** FastAPI + SQLAlchemy/SQLite backend, Vite + React + TypeScript + Tailwind frontend, and the **OpenAI API** for all model calls (structured outputs via `client.beta.chat.completions.parse()` with Pydantic schemas). Model tiering: `gpt-4o-mini` for parsing/redaction, `gpt-4o` for generation, scoring, and guardrail reasoning. Chosen to optimise speed of iteration on prompts and schemas over framework novelty.
2. Should the candidate-facing form include an optional voluntary EEO-style question set, or is that over-engineering for a small-business context?
3. Interview kit delivery: in-app only, or also email/PDF to Sam?
4. Whether to add a post-interview stage (structured note capture against the rubric) as a phase 6 — natural extension, but risks stalling phases 1–5.