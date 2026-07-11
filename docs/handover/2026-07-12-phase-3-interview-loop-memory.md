# Handover — Phase 3: Interview loop & memory

- **Date:** 2026-07-12
- **Author:** horace.hou
- **Status:** Complete on `feat/phase-3-interview-loop` (base `897a1cc` = phase-2 branch tip, 20
  commits); owner ran the live acceptance walk across the full loop — merging via PR (stacked on
  the phase-2 leftover PR)
- **Related:** PRD v2.14 section 10 Phase 3; spec
  `docs/superpowers/specs/2026-07-11-phase-3-interview-loop-memory-design.md`; plan
  `docs/superpowers/plans/2026-07-11-phase-3-interview-loop-memory.md`; decisions D-33…D-36

## Summary
The hiring loop closes: the boss opens interview rounds, generates a filtered five-category
question set, records answers with notes and on-demand AI takes, flags the items that should
count, and closes the round with a summary that produces the narrative outputs, an
`interview_performance` ranking factor derived **only from flagged items** (code-enforced null
when nothing is flagged), and evidence-cited memory proposals. Approvals append dated lessons to
`learned_skills.md`; rejections are recorded; proposals touching protected attributes are refused
by code before the boss ever sees them. Ranking now scores interviewed candidates over six
per-candidate-renormalised factors while un-interviewed candidates score exactly as in Phase 2.

## Scope
PRD Phase 3 exactly (minutes tasks 9–11): F5.1–F5.4, F7.2–F7.3, F4.4–F4.5. Owner decisions:
flag-controlled factor · multiple simple rounds (latest summary wins) · post-interview review +
job Memory tab · starred favourites written directly · Approach A "interactive-direct" (direct
awaited gateway calls; the queue stays analysis-only). **Out:** STT/TTS, cross-round
aggregation, company-memory writes, preference learning.

## What was built
- **Migration 0003** — `memory_events.status` (pending/approved/rejected/refused) + scope index.
- **`src/server/interviews.ts`** — rounds (stage auto-increment), items, answer upserts, boss
  decision (the only writer of `boss_decision` — F4.4), file-first `round-N-record.json` mirror
  rewritten on every mutation.
- **`src/server/ai/sensitive-terms.ts`** — the shared protected-attribute scanner (word-boundary
  regexes incl. 八字/星座; conservative by design) powering both F5.2 filtering and the F7.3 gate.
- **`src/server/ai/interview-ai.ts`** — three direct pipelines over the Phase 2 gateway:
  `generateQuestions` (five categories; prompt + code-side filter with visible drops; once per
  round), `commentOnAnswer` (per-item AI take + confidence), `summariseInterview` (narrative +
  flagged-only factor with a **code null-guard** + screened proposals; re-summary supersedes
  undecided proposals; outputs embed `interviewId`/`stage` so audit labels cannot desync).
- **`src/server/ai/persist.ts`** — the provenance helper extracted from `analyze.ts` (identical
  transactional semantics), now shared by all four pipelines.
- **`src/server/memory.ts`** — the boss gate: approve (transactional dated evidence-cited append
  to `learned_skills.md`) / reject; job memory view; question starring into `question_bank.json`.
- **`src/server/ranking.ts`** — per-candidate factor sets (D-34): `interview_performance 0.2`
  joins when the candidate's latest summary carries a non-null score; per-candidate
  renormalisation; `criteria.per_candidate` records each candidate's factor set.
- **Routes** — 13 new endpoints (`interview-routes.ts`) + `GatewayError → 502` in the central
  onError + strict-JSON body parsing (the Phase 2 lesson) + `GET /interviews/:id/summary`
  (stored narrative, added by the final review — spec section 8 addendum).
- **UI** — CandidatePage Interviews card; InterviewPage (generation with drop banner, per-item
  recording, stars, flags, AI takes, summary panel with evidence + confidence on every
  conclusion, proposal approve/reject, honest Re-summarise caption, stored-summary auto-fetch);
  JobDetail Memory tab (pending proposals, learned-skills card, full event history) + "incl.
  interview" markers in snapshot views.

## How to run & verify
Unchanged (`npm run dev`, `npm test` — never `npx vitest`). README "AI features (Phases 2-3)"
covers the interview features and offline behaviour.

## Verification & results
- **269/269 tests (31 files)** + typecheck clean at HEAD; ~124 new/extended tests including
  transactional-rollback, regression-pinned Phase 2 ranking values, and the out-of-order
  stage-desync case.
- Subagent-driven execution: 12 tasks, per-task reviews with 4 fix loops (scanner
  false-negative gaps; JD-guard ordering aligned across pipelines; strict-JSON on body routes;
  T8 stage-label desync fixed at the source). Task 11 caught and fixed a latent Task 8 UI
  regression (criteria `normalised_weight` removal would have crashed snapshot expansion).
- Final whole-branch review: "ready for owner review"; its three Important findings (evidence +
  confidence rendering in the summary panel; the code null-guard; misleading re-summarise copy +
  the missing stored-summary endpoint) fixed in one wave and re-review-confirmed.
- **No live AI calls were made during this phase** (all fixture-tested; pipelines reuse the
  Phase 2 gateway). The owner's acceptance walk was the live verification — passed on the full
  loop including generation, AI takes, summary, memory approvals, re-ranking, and offline mode.

## Decisions
- **D-33** interactive-direct interview AI; queue stays analysis-only; `GatewayError → 502`.
- **D-34** per-candidate ranking factor sets (amends D-30's run-level all-or-none for the
  interview factor only; boss_preference_match stays run-level).
- **D-35** interview safety mechanics: two-layer F5.2 filtering, code-screened memory gate with
  proposal statuses (migration 0003), flagged-only factor with code null-guard.
- **D-36** self-describing summary payloads + the stored-summary endpoint (spec addendum).

## Known gaps & follow-ups (ride to Phase 4/5)
- Re-summary mid-tx failure can orphan the prior summary md (narrative recoverable from the
  versioned analysis file) — same family as the Phase 2 stale-latest-copy rider.
- "Latest summary wins" (not latest round) drives ranking — deliberate, test-pinned; owner
  confirmed at the walk.
- Body-field type validation absent (number where string expected → 500) — pre-existing pattern,
  localhost single-user.
- Ranking's unguarded `readFileSync` now has two trigger points (P2 rider extended).
- Duplication cleanup candidates: `CONF` map ×3, bank parsing ×2, `parseJsonBody` ×2.
- Memory/interview CRUD routes mount only when `ai` exists (boot always constructs it — smell,
  zero impact).
- UI nits: AI-take gate reads unsaved draft (recoverable 400); star state local-only; GET-summary
  fetch failure leaves a loading line (effectively unreachable locally).
- **Phase 2 riders still open:** transport retry wider than spec; `ai_analysis.json` stale copy
  on tx failure; prompt-delimiter forgeability; `enqueuedTaskIds` rename; vendor-service design
  items (D-31).

## Files & areas touched
`src/server/` (interviews, memory, ai/interview-ai, ai/sensitive-terms, ai/persist,
ai/interview-routes, ranking, routes, app, analyze, migrations 0003),
`src/renderer/src/` (InterviewPage new; CandidatePage, JobDetailPage, App), `tests/` (8 new
files + extensions; 269 total), `README.md`. 20 commits.

## Pick-up notes
Next is the owner-approved **combined Phase 4+5** (communications + data protection & backup) —
one branch, spec/plan sequenced Part A (emails: pure templating, no AI calls) before Part B
(encryption/deletion/backup, which protects everything including Part A's outputs). Read the
Phase 4 and Phase 5 briefs in PRD section 10; the deferred job-deletion (Phase 1 note) lands in
Part B. Revise `docs/design/` at the design session (D-28). Load-bearing patterns: gateway-only
model calls, explicit boss actions, file-first with relative paths, typed errors, migrations for
any schema change, `npm test` only.
