# Phase 3 — Interview Loop & Memory: Design Spec

> Companion: PRD sections 5.5, 6 (F5/F7, F4.4–F4.5), 10 · CONTEXT.md (terms) · DECISIONS.md
> (D-30, D-32) · `docs/design/` (cross-phase overview) | v1.0 · 2026-07-11
> Builds on Phases 0–2. Load-bearing inherited rules: `src/server/` never imports Electron;
> relative forward-slash `*_path`; typed errors mapped once; every model call goes through the
> gateway with a versioned prompt + strict zod schema and lands in `ai_analyses`; explicit boss
> actions for anything that spends tokens (D-30); output-mode instructions are adapter-owned and
> a JD is required before AI work on a job (D-32); all tests via `npm test`.

**Date:** 2026-07-11
**Status:** Approved (owner, 2026-07-11 — approach A "interactive-direct" + four scoping decisions below)
**Source requirements:** PRD section 10 Phase 3 (minutes tasks 9–11); F5.1–F5.4, F7.2–F7.3, F4.4–F4.5, F8.5
**Owner decisions this session:** `interview_performance` is an AI FactorScore computed **only from
items the boss flagged affects-ranking** · **multiple rounds, simply** (stage auto-increments;
latest round's score feeds ranking; no cross-round features) · memory proposals reviewed at the
**post-interview summary + a job Memory tab** (full event history incl. rejections) · boss
favourites come from **starring questions** (direct write to `question_bank.json`, no approval
gate for direct boss actions) · **Approach A: interactive-direct** — interview AI ops are direct
awaited gateway calls, the Phase 2 queue stays analysis-only.

## 1. Summary

The boss opens an interview round for a candidate, generates a question set (five F5.1
categories, drawing on the JD, resume, prior analysis, `question_bank.json`, and
`learned_skills.md`; unlawful questions filtered twice — prompt + code), records it item by item
(answer, boss note, optional on-demand "AI take" with confidence, affects-ranking flag,
star-to-bank), and closes it with one summary call producing the F5.4 narrative outputs, an
`interview_performance` FactorScore built only from flagged items, and evidence-backed memory
proposals. Approving a proposal appends to `learned_skills.md` and records a `memory_events`
row; rejecting records the rejection; proposals touching protected attributes are refused by
code before the boss ever sees them (F7.3). "Rank now" then scores interviewed candidates over
six factors and un-interviewed ones over five, per-candidate renormalised, all recorded in the
snapshot's criteria.

## 2. New modules

| Module | Responsibility | Key exports |
|---|---|---|
| `src/server/interviews.ts` | Interview CRUD over the Phase 0 tables + file mirror under the candidate folder | `createInterview`, `listInterviews`, `getInterview`, `addQuestion`, `saveAnswer`, `setBossDecision` |
| `src/server/ai/interview-ai.ts` | The three gateway pipelines | `generateQuestions`, `commentOnAnswer`, `summariseInterview` |
| `src/server/memory.ts` | The propose→approve→write gate + question-bank starring | `screenProposals`, `decideProposal`, `getJobMemory`, `starQuestion` |
| `src/server/ai/sensitive-terms.ts` | Shared protected-attribute/unlawful-topic term list + `scanText(text): string[]` (matched terms) | used by question filtering AND the memory gate |
| `src/server/ai/routes.ts` (extended) | New REST surface (section 8) | — |
| `src/server/ranking.ts` (amended) | Per-candidate factor sets incl. `interview_performance` | (same exports) |

**No new dependencies.** Migration **0003**: `ALTER TABLE memory_events ADD COLUMN status TEXT
NOT NULL DEFAULT 'pending'` + `CREATE INDEX idx_memory_events_scope ON memory_events(scope,
scope_id)`. (`approved_by_boss` stays and is set to 1 on approval — the acceptance criteria
require rejected/refused to be distinguishable, which the Phase 0 column alone cannot express.)

## 3. Data & files

- **Rows:** `interviews` (stage = max(stage)+1 per candidate; `mode='manual'`; `ai_score` set
  from the summary's factor score; `boss_decision` free-text set only by the boss — F4.4;
  `transcript_path`/`summary_path` set when files are written). `interview_questions`
  (`order_index` append-only; `category` one of the five F5.1 values; `source`
  `'generated'|'manual'`). `interview_answers` (one per question, upserted; `ai_comment` +
  `confidence` REAL .33/.66/1; `affects_ranking` 0/1; `source='manual'`).
- **Files (file-first mirror, candidate folder):**
  `interviews/round-<stage>-record.json` — full round state (questions, answers, notes, flags,
  AI comments), rewritten on every mutation; `transcript_path` points at it.
  `interviews/round-<stage>-summary.md` — the rendered summary; `summary_path` points at it.
- **AI provenance:** every pipeline call inserts `ai_analyses` (new kinds
  `question_generation` · `answer_comment` · `interview_summary`) with versioned prompt ids and
  versioned output files under `analyses/` — identical persistence pattern to Phase 2.
- **Memory:** proposals become `memory_events` rows at summary time — `status='pending'`
  (screened) or `'refused'` (failed the code screen; reason in content JSON; never shown as
  pending). Boss decisions flip pending → `'approved'` (+`approved_by_boss=1`, and the
  `learned_skills.md` append happens in the same transaction) or `'rejected'`. `content` is JSON:
  `{ lesson, evidence: [{quote, source}], refusalReason? }`; `scope='job'`, `scope_id=<jobId>`,
  `source_type='interview'`, `source_id=<interviewId>`.
- **`learned_skills.md` append format** (boss-editable, append-only by the app):

```
## 2026-07-11 — from <candidate name>, round <n>
- <lesson> _(evidence: "<quote>")_
```

- **`question_bank.json`** becomes `{ "questions": [{ "text": ..., "addedAt": ISO }] }`;
  `starQuestion` dedupes case-insensitively by text. Direct boss action — no gate.

## 4. Pipelines (`ai/interview-ai.ts`) — all direct awaited gateway calls

All three: JD required (D-32 — jobs reached via the candidate), context assembled with the same
`readRel`-style manifest discipline as `analyze.ts`, `ai_analyses` row + versioned output, typed
`GatewayError`s surface to the UI as visible retryable failures.

1. **`generateQuestions(deps, interviewId)`** — context: JD · resume text · latest candidate
   analysis (summary, risk_points, recommended_questions) if present · `question_bank.json`
   entries · non-empty `learned_skills.md`. Output (strict zod): `{ questions: [{ category:
   'standard'|'resume_specific'|'jd_risk'|'boss_favourite'|'follow_up', text, rationale }]
   (5..25) }` — prompt requires all five categories when material allows (boss_favourite only
   when the bank is non-empty). **F5.2 filtering, two layers:** the prompt carries F8.5 plus an
   explicit unlawful-topics list; then code runs `scanText` over every question and **drops**
   matches, returning `{ added, dropped: [{text, terms}] }` — dropped count is shown, never
   silent. Persists `interview_questions` rows (source `generated`). Allowed once per interview
   (409 after — regenerate by adding a new round; manual questions are always allowed).
2. **`commentOnAnswer(deps, questionId)`** — 400 unless an answer exists. Context: JD (trimmed
   to first 2,000 chars) · the question · answer text · boss note. Output: `{ comment,
   confidence: 'low'|'medium'|'high' }` → stored on the answer row (confidence mapped to REAL).
   Re-comment allowed (overwrites; provenance keeps every call).
3. **`summariseInterview(deps, interviewId)`** — 409 unless ≥1 answered item. Context: JD ·
   resume text · every item (question, category, answer, boss note, AI comment, **flag**) ·
   latest candidate-analysis factor summary. Output (strict zod):

```
{
  summary: string,
  soft_skill_observations: Judgment-like { assessment, evidence: InterviewEvidence[]≥1, confidence },
  stability_inference:      same shape,
  risk_points:              same shape[],
  recommended_follow_ups:   string[] (0..8),
  next_round_recommendation: { verdict: 'advance'|'reject'|'another_round', reason },
  interview_performance: FactorScore-like { score 0..100, reason,
      evidence: InterviewEvidence[]≥1, confidence } | null,   // null when NO items were flagged
  memory_proposals: [{ lesson, evidence: InterviewEvidence[]≥1 }] (0..5)
}
```

   `InterviewEvidence = { quote, source: 'interview'|'resume'|'jd' }` (new schema — the Phase 2
   `Evidence` enum is not modified). The prompt states: interview_performance derives **only**
   from flagged items; with none flagged it must be null. Persists: summary md file, row updates
   (`summary_path`, `ai_score`), provenance, and screened `memory_events` rows. Re-summarise
   allowed (new versioned analysis; files and pending proposals replaced — undecided pending
   rows from the prior summary of the same interview are superseded → status `'rejected'` with
   a `refusalReason: 'superseded by re-summary'` note in content).

## 5. Ranking amendment (per-candidate factor sets — D-30 amendment)

- `RANKING_WEIGHTS` gains `interview_performance: 0.20` (base weights are relative importances;
  per-run normalisation already exists).
- Per candidate: factor set = the five resume factors (boss_preference_match still **all-or-none
  across the run** — it is a job-configuration property) **plus `interview_performance` when that
  candidate's latest interview summary carries a non-null score** (a candidate-journey property —
  all-or-none would make the factor unusable, since only shortlists get interviewed). Weights
  renormalised **per candidate** over that candidate's present factors.
- `criteria` records `per_candidate: [{ candidate_id, factors: [key…], interview_analysis_id? }]`
  alongside the existing recipe; the snapshot view and ranked list mark interviewed candidates
  (e.g. "incl. interview round 2").
- Un-interviewed candidates' scores are computed exactly as in Phase 2 — regression-tested.

## 6. Memory gate (`memory.ts`, F7.2/F7.3)

- **Screen (code, before the boss sees anything):** `screenProposals` runs `scanText` over
  lesson + evidence quotes; matches → `status='refused'` with the matched terms as the visible
  reason. Refusals appear in the Memory tab history, never as pending.
- **Decide:** `decideProposal(id, 'approved'|'rejected')` — 404 unknown, 409 unless `pending`.
  Approval appends the learned-skills block and flips the row in **one transaction** (file write
  inside the tx, Phase 1/2 rollback pattern); rejection just flips status.
- **Read:** `getJobMemory(jobId)` → current `learned_skills.md` content + all job-scoped events
  (pending / approved / rejected / refused) newest first.
- Next `generateQuestions` naturally reads the updated file (F7.2's "referenced by the next
  question-bank generation").

## 7. Prompts & schemas

New versioned prompts in `ai/prompts.ts`: `question-generation/v1`, `answer-comment/v1`,
`interview-summary/v1` — all built on `SYSTEM_CONSTRAINTS` (F8.5 verbatim), all treating
candidate answers as **untrusted content** (same delimited-block discipline as resumes; answers
are candidate speech transcribed by the boss). New zod schemas + hand-written JSON schemas in
`ai/schemas.ts` following the Phase 2 pattern (`.strict()` everywhere, evidence ≥1 on every
conclusion, enums for categories/verdicts/confidence).

## 8. REST surface (extends `registerAiRoutes`; same error mapping)

| Route | Request | Success | Errors |
|---|---|---|---|
| `POST /candidates/:id/interviews` | — | `201 {interview}` (stage auto) | `404` |
| `GET /candidates/:id/interviews` | — | `200 [{id, stage, createdAt, hasSummary, aiScore, bossDecision}]` | `404` |
| `GET /interviews/:id` | — | `200` interview + items (questions joined with answers) | `404` |
| `PATCH /interviews/:id` | `{ bossDecision }` | `200` | `400` · `404` |
| `POST /interviews/:id/questions/generate` | — | `200 { added, dropped }` | `404` · `409` already generated · `422`-style gateway failures as visible errors |
| `POST /interviews/:id/questions` | `{ text }` | `201` (source `manual`) | `400` · `404` |
| `POST /interview-questions/:id/star` | — | `200 { bank }` | `404` |
| `PUT /interview-questions/:id/answer` | `{ answerText?, bossNote?, affectsRanking? }` | `200` (upsert) | `400` · `404` |
| `POST /interview-questions/:id/ai-comment` | — | `200 { comment, confidence }` | `400` no answer · `404` |
| `POST /interviews/:id/summary` | — | `200` full summary + pending proposals | `404` · `409` no answered items |
| `POST /memory-events/:id/approve` · `/reject` | — | `200 { event }` | `404` · `409` not pending |
| `GET /jobs/:id/memory` | — | `200 { learnedSkills, events }` | `404` |

**GatewayError mapping (new — the queue absorbed these in Phase 2; direct calls must not
become 500s):** the AI error handler maps `GatewayError` → **502** `{ error: message, code }` so
the UI renders the same visible retryable failure states as analysis tasks.

## 9. UI (solid-foundation continuation; tokens only)

- **CandidatePage — Interviews section:** rounds list (stage, date, AI score, boss decision,
  summary badge) + "New interview round".
- **InterviewPage (`/interviews/:id`):** header (candidate/job/round, boss-decision input);
  "Generate questions" (shows dropped-count when filtering fired) + "Add question"; per-item
  card — question (category chip, star toggle), answer textarea, boss-note field,
  affects-ranking toggle, "AI take" button → comment + confidence chip; "Summarise interview"
  → summary panel: narrative sections, interview-performance score with evidence + "from N
  flagged items" caption (or "no items flagged — no ranking factor"), next-round
  recommendation badge, and the proposals list with per-proposal Approve/Reject (+ visible
  refused items with reasons).
- **JobDetailPage — Memory section:** rendered `learned_skills.md` + event history with status
  chips; pending proposals actionable here too.
- Ranked list/snapshot view: interviewed candidates marked (criteria-driven).
- All AI buttons show in-flight state and visible retryable failures (`auth`/`network`/etc.) —
  offline, everything except the three AI actions keeps working.

## 10. Testing (all offline; fixtures; suite stays green)

| Test file | Covers |
|---|---|
| `tests/migration-0003.test.ts` | 0003 applies over 0001+0002; status default `pending`; index exists |
| `tests/interviews.test.ts` | stage auto-increment; item CRUD + upsert answer; record.json mirror on every mutation; boss decision; 404s |
| `tests/sensitive-terms.test.ts` | scanText hits protected-attribute/unlawful terms, clean text passes |
| `tests/interview-ai.test.ts` | mock gateway: question persistence + category coverage + code-side filter drops planted unlawful questions (visible count) + 409 on regenerate; comment stored with confidence mapping + 400 without answer; summary persists files/rows/provenance, interview_performance null when nothing flagged, proposals screened (refused never pending), re-summary supersedes pending |
| `tests/memory.test.ts` | approve appends the exact block format + flips status in one tx (fs-failure rollback); reject leaves file untouched; 409 on decided; getJobMemory shape; starQuestion dedupe |
| `tests/ranking.test.ts` (extended) | interviewed candidate scored over 6 per-candidate-renormalised factors; un-interviewed unchanged vs Phase 2 (regression); criteria per_candidate shape; latest-round-wins |
| `tests/ai-routes.test.ts` (extended) | the section 8 surface incl. 409s and the approve/reject flow |

## 11. Out of scope (Phase 3)

STT/TTS (post-MVP, D-6) · cross-round comparison/aggregation (post-MVP backlog) · company-memory
writes (no write path until a later phase; scope stays `job`) · boss-preference *learning* ·
question reordering/editing UI beyond append · email templates (P4) · encryption (P5).

## 12. Acceptance criteria (PRD Phase 3, made concrete)

1. Generate a question set → all five F5.1 categories present (boss_favourite fed from a
   non-empty bank); a planted unlawful question is dropped with a visible count (fixture test).
2. Record a round: per-item answer, boss note, on-demand AI comment + confidence, affects-ranking
   flag; `round-N-record.json` mirrors on disk after every save.
3. Summarise → all F5.4 outputs; `interview_performance` derives only from flagged items (none
   flagged → explicitly no factor); `interviews.ai_score` + `summary_path` set; next "Rank now"
   appends a snapshot where the interviewed candidate carries the factor, un-interviewed
   candidates score exactly as before, and `criteria` records per-candidate factor sets.
4. An approved proposal lands in `learned_skills.md` (dated, evidence-cited) + `memory_events`
   `approved`; a rejected one is recorded `rejected` with the file untouched; a proposal
   encoding a protected attribute is `refused` with a visible reason and never appears pending.
5. A starred question is in `question_bank.json` and the next generation surfaces it under
   boss_favourite.
6. The boss decision is recorded on the interview row, separate from every AI output (F4.4).
7. Offline: everything except the three AI actions keeps working; those fail visibly and retry.
