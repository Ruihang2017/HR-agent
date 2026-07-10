# Handover — Phase 2: AI analysis & ranking

- **Date:** 2026-07-11
- **Author:** horace.hou
- **Status:** Complete on `feat/phase-2-ai-analysis` (base `89aebad`, 18 commits); owner ran the
  eval + full manual acceptance walk across all three providers — merging via PR (stacked on the
  Phase 1 PR)
- **Related:** PRD v2.13 section 10 Phase 2; spec
  `docs/superpowers/specs/2026-07-11-phase-2-ai-analysis-ranking-design.md`; plan
  `docs/superpowers/plans/2026-07-11-phase-2-ai-analysis-ranking.md`; decisions D-29…D-32;
  eval results `docs/superpowers/evals/2026-07-10-phase-2-eval.md`

## Summary
The product's core intelligence is real: the boss picks a model (with the D-11 risk disclosure),
explicitly queues candidate analyses, and gets evidence-and-confidence-backed analyses for every
F3.1 dimension, then explicit "Rank now" runs that persist immutable, fully-explainable snapshots
composed by auditable arithmetic in code. All model traffic goes through one gateway with three
hand-rolled raw-HTTP adapters (OpenAI / DeepSeek / Anthropic — zero provider SDKs); switching
provider is a settings change and the next analysis records the new provider/model with zero
feature-code changes. The vendor subscription service is stubbed behind a `TokenIssuer` seam with
advisory local metering. Verified live on all three providers.

## Scope
PRD Phase 2 exactly (minutes tasks 7–8): F3.1–F3.5, F4.1–F4.4, F8.5, D-9…D-13 surfaces. Owner
scoping decisions this phase: all three providers live · subscription = interface + dev stub +
advisory metering · analysis and ranking are explicit boss actions · absent ranking factors are
excluded and recorded · **Approach C: queue-first**. **Out:** interviews/memory (P3), real vendor
service, streaming, OCR.

## What was built
- **Migration 0002** — `analysis_tasks` (restart-safe queue) + `usage_events` (advisory
  metering); first non-noop run of the Phase 0 migration runner.
- **`src/server/ai/`** (Electron-free): `schemas.ts` (strict zod `AnalysisOutput` + provider JSON
  schema); `prompts.ts` (versioned `candidate-analysis/v1`, F8.5 verbatim, resume delimited as
  untrusted); `catalog.ts` (models-by-plan constants + D-11 disclosures + D-13 stub allowances);
  `subscription.ts` (`TokenIssuer` seam + `DevTokenIssuer` from env); `settings.ts` (validated
  `ai.provider`/`ai.model`); `gateway.ts` (single call site: typed `GatewayError`s, transport
  retries w/ backoff, one corrective re-ask on invalid output, per-call `usage_events`);
  `adapters/` (openai `json_schema` strict · deepseek `json_object`+schema-in-system · anthropic
  forced tool-use — **each adapter owns its output-mode instruction**, D-32); `analyze.ts`
  (context assembly with provenance manifest, versioned `analyses/analysis_<id>.json` + latest
  `ai_analysis.json`, transactional with rollback, requires a JD); `queue.ts` (dedupe, concurrency
  2, boot recovery, explicit retry); `runtime.ts` + `routes.ts` (the REST surface).
- **`src/server/ranking.ts`** — latest-analysis-per-candidate, weights renormalised over present
  factors (interview_performance excluded until P3; boss_preference_match all-or-none), total
  composed in code, immutable snapshot with a full `criteria` recipe; excluded candidates always
  reported, never silent.
- **UI:** Settings page (plan card + DEV MODE banner, advisory usage bar, model picker with
  disclosure-before-confirm); JobDetail (Analysis status column with retry, "Analyse all new",
  "Rank now", expandable snapshot viewer with criteria caption); Candidate page (full analysis
  panel: dimensions/evidence/confidence chips, amber sensitive-flags box, factor scores,
  recommended questions, provider/model/prompt-version caption, honest failure states).
- **`scripts/ai-eval.mjs`** — dry-run-by-default cross-provider eval (5 synthetic resumes incl. a
  sensitive/scrubbed pair; `--yes` to spend); results land in `docs/superpowers/evals/`.
- **Electron wiring:** dev-only `.env` loader (quote-stripping, never logged), boot recovery
  (`resetRunning` + `kick` after listen).

## How to run & verify
`README.md` → "AI features (Phase 2)": the three `.env` keys, Settings page, offline behaviour,
eval usage. All tests via `npm test` (never `npx vitest`, D-23).

## Verification & results
- **145/145 tests (23 files)** + typecheck clean at HEAD. All gateway/adapter/pipeline tests run
  on injected fixtures — the suite needs no keys and no network.
- Subagent-driven execution: 12 tasks, per-task spec+quality reviews with fix loops; final
  whole-branch review (verdict "ready", its 3 Important findings fixed and re-review-confirmed).
- **Live verification:** controlled in-app smoke (real gpt-5-mini analysis end-to-end incl.
  sensitive-flagging and the keyless-provider failure path); owner ran the cross-provider eval —
  OpenAI 5/5 · DeepSeek 5/5 · Anthropic 4/5 (the one failure probed 2/2 successful on identical
  retry: a nondeterministic flake, covered in-app by the gateway's corrective re-ask; the eval is
  single-shot by design); sensitive-vs-scrubbed factor deltas all ≤10 with flags firing (F3.4).
- Owner ran the full manual acceptance walk (spec section 15) across all three providers — passing.

## Post-eval debugging (root causes worth remembering)
Both in-app provider failures shared one error (`invalid_output`) but had different causes:
1. **Empty JD:** a job with a blank `jd.md` made honest models return empty evidence arrays →
   strict schema rejection. Fixed at source: analysing now requires a JD (clear `ValidationError`
   at the button and in the pipeline).
2. **Instruction/tool-mode conflict:** the shared prompt's "respond with a single JSON object"
   line made Claude's forced tool-calls emit malformed input. Fixed at source: output-mode
   instructions are adapter-owned (D-32). Also learned: claude-sonnet-5 rejects assistant-prefill.

## Decisions
- **D-29** queue-first architecture + raw-HTTP adapters, no provider SDKs; zod the only new dep.
- **D-30** explicit AI actions; ranking composition rules (renormalisation, all-or-none,
  exclusions recorded in `criteria`).
- **D-31** subscription dev-stub: `TokenIssuer` seam + advisory metering; catalog ids as code
  constants; stub allowances are placeholders.
- **D-32** adapter-owned output-mode instructions + JD-required-before-analysis.

## Known gaps & follow-ups (ride to Phase 3)
- Transport retry is wider than spec (retries permanent 4xx too — wastes ~5s on impossible calls).
- `ai_analysis.json` latest-copy can be left stale-overwritten if the persist transaction fails
  mid-write (versioned files + DB stay consistent; file-browsing-only impact).
- `ranking.ts` 500s if the boss deletes/corrupts an analysis file — should exclude with a reason.
- `enqueued` returns task ids while `skipped` uses candidate ids — rename to `enqueuedTaskIds`.
- Prompt block delimiters are forgeable by resume text (resume is last block; damage contained) —
  P3 hardening item. Shared `maxOutputTokens` 8000 — watch for truncation on reasoning-heavy models.
- Assorted minors: dead tier-rejection branch until the vendor service; Shell nav colors
  hardcoded (since P1); CandidatePage poll deps miss candidateId (unreachable today); Re-analyse
  not disabled while active; eval filename uses UTC date (off-by-one locally).
- **Phase 1 riders still open:** shared multipart helper, JD-route 413 test, getCandidate
  extraction default, extension whitelist.
- **Vendor-service design items** (deferred with D-31): token TTL/rotation/revocation, DeepSeek
  metering controls, offline grace, at-cap behaviour, real allowances.

## Files & areas touched
`src/server/ai/` (12 new modules + adapters), `src/server/ranking.ts`, migration 0002,
`src/server/app.ts` (optional `ai` dep), `src/main/index.ts` (env loader + boot recovery),
`src/renderer/src/` (SettingsPage + JobDetail/Candidate/Shell/StatusBadge/api updates),
`scripts/ai-eval.mjs`, `tests/` (10 new files; 145 total), `README.md`, `package.json` (zod).
18 commits on `feat/phase-2-ai-analysis`.

## Pick-up notes
Next is **Phase 3 — Interview loop & memory** (PRD section 10, tasks 9–11): question generation
(five F5.1 categories) via the same gateway, manual interview recording, post-interview re-ranking
(new snapshot — the `interview_performance` factor slots into the D-30 composition), and the
propose→approve→write memory gate (`learned_skills.md` + `memory_events`, discriminatory
proposals refused — F7.2/F7.3). Start with a brainstorming/design session; revise `docs/design/`
as part of it (D-28 standing item). Load-bearing patterns: everything goes through the gateway
(new `kind` values, versioned prompts); explicit boss actions for anything that spends tokens;
ranking snapshots stay immutable — re-ranking always appends.
