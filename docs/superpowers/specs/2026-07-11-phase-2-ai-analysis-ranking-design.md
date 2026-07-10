# Phase 2 — AI Analysis & Ranking: Design Spec

> Companion: PRD sections 5.3, 6 (F3/F4), 7, 10 · CONTEXT.md (terms) · DECISIONS.md (D-9…D-13) ·
> `docs/design/` (cross-phase overview) | v1.0 · 2026-07-11
> Builds on Phase 0 foundation + Phase 1 job workspace. Load-bearing inherited rules:
> `src/server/` never imports Electron; relative forward-slash `*_path`; typed errors mapped once;
> all tests via `npm test`; no native modules beyond better-sqlite3.

**Date:** 2026-07-11
**Status:** Approved (owner chose Approach C — queue-first — plus the four scoping decisions below, 2026-07-11; detail design delegated for overnight execution, owner reviews in the morning)
**Source requirements:** PRD section 10 Phase 2 (minutes tasks 7–8); F3.1–F3.5, F4.1–F4.4, F8.5; D-9…D-13
**Owner decisions this session:** all three providers live (owner supplies DeepSeek + Anthropic keys) · subscription = token-issuance interface + dev stub **+ advisory local metering** · analysis is explicit (per-candidate + "Analyse all new") · ranking is explicit ("Rank now"), absent factors **excluded** and recorded in `criteria` · **Approach C: queue-first** — raw-HTTP adapters (no provider SDKs) + a restart-safe server-side analysis queue.

## 1. Summary

The boss selects a model (with provider-risk disclosure), queues analyses for candidates
(explicitly), and gets per-candidate analyses — every F3.1 dimension with evidence + confidence —
plus explicit "Rank now" runs that persist immutable snapshots composed by auditable arithmetic
in code. All model traffic goes through one gateway with three hand-rolled provider adapters
(OpenAI, DeepSeek, Anthropic) over raw `fetch`; switching provider is a settings change, zero
feature-code changes. The vendor subscription service is stubbed: a token-issuer interface with a
dev implementation reading `.env` keys, a fake Pro plan, and advisory token metering against the
D-13 allowances. Failures are visible states ("analysis unavailable — retry"), never fabricated
scores.

## 2. New modules

All Electron-free. New subdirectory `src/server/ai/` for the model side; ranking is domain logic
at `src/server/ranking.ts`.

| Module | Responsibility | Key exports |
|---|---|---|
| `ai/schemas.ts` | zod schemas for structured model output | `AnalysisOutput`, `Evidence`, `FactorScore`, TS types |
| `ai/prompts.ts` | Versioned prompt assets (F8.5 verbatim; delimited untrusted input) | `ANALYSIS_PROMPT_VERSION`, `buildAnalysisPrompt(materials)` |
| `ai/catalog.ts` | Model catalog constants by plan tier + per-provider risk disclosures (D-11) + D-13 allowance constants | `CATALOG`, `PLANS`, `disclosureFor(provider)` |
| `ai/subscription.ts` | Token-issuer interface + dev stub; plan state | `TokenIssuer`, `DevTokenIssuer`, `getPlan` |
| `ai/settings.ts` | AI settings over the `settings` table (provider/model validated against catalog+plan) | `getAiSettings`, `setAiSettings` |
| `ai/gateway.ts` | The single call site: adapter dispatch, bounded retry, timeout, usage recording, typed `GatewayError` | `Gateway`, `GatewayError` |
| `ai/adapters/openai.ts` `deepseek.ts` `anthropic.ts` | One raw-`fetch` adapter per provider; structured-output strategy per provider | `openaiAdapter` etc. (uniform `ProviderAdapter` interface) |
| `ai/analyze.ts` | The analysis pipeline: assemble context → gateway → persist | `analyzeCandidate(deps, candidateId)` |
| `ai/queue.ts` | Restart-safe analysis queue: enqueue/dedupe, claim, worker pool, boot recovery | `enqueueAnalyses`, `startWorker`, `resetRunningTasks` |
| `ranking.ts` | Ranking runs: compose scores in code, persist immutable snapshot | `runRanking`, `listRankings`, `getRanking` |
| `ai/routes.ts` | Mounts the Phase 2 REST surface | `registerAiRoutes(app, deps)` |

**New dependency:** `zod` (pure JS). **No provider SDKs.** `fetch` is global (Node 22 / Electron
main); adapters take an injectable `fetchFn` for fixture tests.

## 3. Schema — migration 0002 (first non-noop use of the runner)

```sql
CREATE TABLE analysis_tasks (
  id           INTEGER PRIMARY KEY,
  job_id       INTEGER NOT NULL REFERENCES jobs(id),
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  status       TEXT NOT NULL DEFAULT 'queued',   -- queued | running | succeeded | failed
  error        TEXT,                              -- GatewayError code + message when failed
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX idx_analysis_tasks_job_id ON analysis_tasks(job_id);
CREATE INDEX idx_analysis_tasks_candidate_id ON analysis_tasks(candidate_id);

CREATE TABLE usage_events (
  id                INTEGER PRIMARY KEY,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  kind              TEXT NOT NULL,                -- 'candidate_analysis' (Phase 3 adds kinds)
  prompt_tokens     INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  job_id            INTEGER,
  candidate_id      INTEGER,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_usage_events_created_at ON usage_events(created_at);
```

No changes to existing tables. `ai_analyses`, `rankings`, `ranking_items` (with immutability
triggers) shipped in Phase 0 and are used as-is.

## 4. Subscription layer (D-10/D-12/D-13, stubbed)

- **`TokenIssuer` interface:** `getCredentials(provider) → { apiKey, baseUrl? }` — throws
  `GatewayError('auth')` when no credential. This is the seam where the real vendor
  token-issuance client lands later; nothing else changes when it does.
- **`DevTokenIssuer`:** reads `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY` from an
  injected env map. The main process builds that map from `process.env` merged with a ~10-line
  parse of the repo-root `.env` in dev (no dotenv dependency; packaged builds use `process.env`
  only). Keys never leave the main process; never logged; `.env` stays gitignored.
- **Plan:** stub constant `pro` ("Jobpin Pro (dev)"), allowances from `catalog.ts`:
  Free = 200k tokens / month (expires after 1 month), Pro = 5,000k tokens / month (A$20). The
  numbers are **advisory dev-stub values** — real allowances are vendor-service design items.
- **Metering (advisory):** every gateway call inserts a `usage_events` row from the provider's
  reported usage. `GET /ai/usage` sums the current calendar month vs the plan allowance for the
  UI bar. **No enforcement** — at-cap behaviour is a vendor-service design item (D-13).
- **Settings keys** (`settings` table): `ai.provider`, `ai.model` (validated against the
  catalog for the active plan). Defaults on first read: `openai` / the catalog's default model.

## 5. Model catalog & risk disclosure (D-11, D-13)

`CATALOG`: per provider, 1–2 current chat models with `{ id, label, tiers: ['free'|'pro'] }` —
exact model ids are code constants verified during the live smoke run (they churn; changing them
is a one-line edit). Initial set: OpenAI `gpt-5.1` (pro) + `gpt-5-mini` (free/pro); DeepSeek
`deepseek-chat` (free/pro); Anthropic `claude-sonnet-5` (pro) + `claude-haiku-4-5` (free/pro).
Default: `openai` / `gpt-5-mini`.

`disclosureFor(provider)` returns the D-11 text shown at model selection: candidate content is
sent to the provider at call time (stateless); provider jurisdiction note (OpenAI — US ·
DeepSeek — People's Republic of China · Anthropic — US); choice is the boss's, with the
liability disclaimer living in the terms. The UI must render this **at selection time**, not
buried in settings.

## 6. Gateway & adapters

**Uniform adapter interface:**

```ts
interface ProviderAdapter {
  complete(req: {
    system: string; user: string;
    schemaName: string; jsonSchema: object;       // zod → JSON schema, precomputed
    maxOutputTokens: number;
  }, creds: Credentials, fetchFn: typeof fetch, signal: AbortSignal):
    Promise<{ rawText: string; usage: { prompt: number; completion: number } }>
}
```

**Per-provider structured-output strategy:**

| Provider | Endpoint | Strategy |
|---|---|---|
| OpenAI | `POST /v1/chat/completions` | `response_format: { type: 'json_schema', strict: true }` |
| DeepSeek | `POST /chat/completions` (OpenAI-compatible, `baseUrl` override) | `response_format: { type: 'json_object' }` + schema text in prompt; gateway validate-and-retry |
| Anthropic | `POST /v1/messages` | one forced tool (`tool_choice: { type: 'tool', name: schemaName }`) whose `input_schema` is the JSON schema; output = tool input |

**Gateway behaviour (`Gateway.complete<T>`):**
1. Resolve settings (provider/model) + credentials (issuer).
2. Call adapter with 60s timeout (`AbortSignal.timeout`).
3. Parse `rawText` → JSON → zod-validate. On parse/validation failure: **one** re-ask appending
   the validation errors (`invalid_output` after the second failure).
4. Transport retry: up to 2 retries on 429/5xx/network with exponential backoff (1s, 4s);
   401/403 → `auth` immediately, no retry.
5. Record `usage_events` row (even on validation failure — tokens were spent).
6. Return `{ output: T, usage, provider, model }`.

**`GatewayError` codes:** `auth` · `rate_limit` · `network` · `timeout` · `invalid_output` ·
`provider_error`. The queue stores `code: message` in `analysis_tasks.error`; the UI renders a
human-readable retry state. Keys are never included in error messages or logs.

## 7. Analysis pipeline (`analyze.ts`)

```
load candidate + job (404 guards)
  → require extracted resume text (else fail task: 'no extracted text — resolve needs_review first')
  → assemble materials: jd.md · inject.md · references/*.md · company/values.md (if present)
      · company/boss_preferences.json (if present) · jobs learned_skills.md (if non-empty)
      · resume_text.md  [UNTRUSTED — delimited, never merged into system prompt]
  → buildAnalysisPrompt(materials)   (system = F8.5 verbatim + role + output contract;
                                      user = labelled delimited blocks)
  → gateway.complete(AnalysisOutput)
  → persist:
      candidates/<id>/analyses/analysis_<aiAnalysisId>.json   (versioned, one per run — F3.2)
      candidates/<id>/ai_analysis.json                        (copy of latest — PRD 8.2 layout)
      ai_analyses row { kind:'candidate_analysis', provider, model,
                        prompt_version: ANALYSIS_PROMPT_VERSION,
                        input_manifest: JSON [{kind, path, chars} per material],
                        output_path: relative path to the versioned file,
                        confidence: overall (min of factor confidences mapped low=.33/med=.66/high=1) }
```

Write order mirrors Phase 1 candidates: DB row first inside a transaction, files second, rollback
removes partials. Re-analysis is allowed and appends a new row + versioned file (the `analyses/`
subfolder is additive to the PRD 8.2 tree; `ai_analysis.json` remains the latest, per the layout).

**`AnalysisOutput` (zod, exact fields):**

```ts
Evidence    = { quote: string, source: 'resume'|'jd'|'inject'|'references'|'values'|'preferences' }
Judgment    = { assessment: string, evidence: Evidence[] (min 1), confidence: 'low'|'medium'|'high' }
FactorScore = { score: number (0–100), reason: string, evidence: Evidence[] (min 1),
                confidence: 'low'|'medium'|'high' }

AnalysisOutput = {
  summary: string,
  dimensions: {                       // F3.1, every dimension a Judgment
    jd_fit, must_have_skills, bonus_skills, career_continuity,
    growth_trajectory, communication_style, soft_skill_evidence: Judgment,
    risk_points: Judgment[],          // 0..n discrete risks
  },
  recommended_questions: string[],    // 1..8
  recommendation: 'strong_yes'|'yes'|'maybe'|'no',   // the AI-recommended rank signal (F3.1)
  factors: {                          // feed the section 5.3 composition
    jd_fit, key_skills, relevant_experience, growth_trajectory: FactorScore,
    boss_preference_match: FactorScore | null,       // null when no boss_preferences.json
  },
  sensitive_flags: { attribute: string, note: string }[],  // F3.4: flag-and-exclude
}
```

Sensitive flags are **display-only**: nothing in ranking composition reads them, and factor
prompts instruct the model that flagged attributes must not influence any score (F8.5). The
"demonstrably don't move the score" acceptance item is verified by the eval script (section 12)
plus a unit test proving composition never reads `sensitive_flags`.

## 8. Queue (`queue.ts`) — Approach C

- **Enqueue** (`enqueueAnalyses(deps, jobId, candidateIds?)`): absent ids = "all new" — every
  job candidate with extracted text and no `succeeded`/`queued`/`running` task. Per candidate:
  skip with reason if no extracted text, or if a `queued`/`running` task exists (dedupe).
  Explicit re-analysis of a `succeeded` candidate is allowed (new task). Returns
  `{ enqueued: taskIds[], skipped: [{candidateId, reason}] }`.
- **Worker:** in-process pool, **concurrency 2**. `kick()` after every enqueue and at server
  boot. Claim = one `UPDATE … SET status='running', attempts=attempts+1, started_at=now WHERE id
  = (SELECT id FROM analysis_tasks WHERE status='queued' ORDER BY id LIMIT 1) RETURNING *`
  (single-process SQLite — atomic enough). Run `analyzeCandidate`; mark `succeeded`, or `failed`
  with the `GatewayError` code + message. No automatic task-level retries (gateway already
  retries transport errors); the boss retries explicitly.
- **Boot recovery:** `resetRunningTasks(db)` flips `running` → `queued` at server start (crash
  = re-run; analysis is idempotent-append, worst case a duplicate analysis row).
- **Retry:** `POST /analysis-tasks/:id/retry` re-queues a `failed` task (409 otherwise).

## 9. Ranking (`ranking.ts`)

`runRanking(deps, jobId)`:
1. Latest `succeeded` analysis per candidate (by `ai_analyses.id`). Zero analysed → 400
   `ValidationError('no analysed candidates to rank')`. Unanalysed candidates are excluded and
   listed in the response (never silently).
2. **Composition in code** — base weights: `jd_fit .35 · key_skills .25 · relevant_experience
   .20 · growth_trajectory .10 · boss_preference_match .10`; `interview_performance` exists in
   the section 5.3 formula but has no Phase 2 source → excluded. Factors absent for a given run
   (`boss_preference_match: null`) are excluded too; remaining weights **renormalised to sum 1**.
   `total = Σ normalised_weight × factor.score`, rounded to 1 decimal. All candidates in one run
   are scored with the same factor set: `boss_preference_match` participates only if **every**
   included analysis has it (else excluded for the run — comparability beats completeness).
3. Rank by score desc; ties broken by earlier `candidates.created_at` then id (deterministic).
4. Persist snapshot: `rankings { job_id, criteria, reason }` + `ranking_items { rank, score,
   reason }` (per-candidate reason = the factor-weighted one-liner built from the analysis
   summary + top factor reasons). `criteria` JSON records the full recipe:
   `{ prompt_version, factors: [{key, base_weight, normalised_weight}], excluded: [key…],
   inputs: [{candidate_id, analysis_id, provider, model}] }` — every rank explainable from the
   snapshot alone (F4.2/F4.3).
5. Immutability is the DB's job (Phase 0 triggers); the service never updates or deletes
   snapshots, and a regression test proves UPDATE/DELETE still abort.

## 10. REST surface (`ai/routes.ts`, mounted by `createApp`)

| Route | Request | Success | Errors |
|---|---|---|---|
| `POST /jobs/:id/analyses` | JSON `{ candidateIds?: number[] }` (absent = all new) | `202 { enqueued, skipped }` | `404` job |
| `GET /jobs/:id/analyses` | — | `200` per-candidate: task status + latest analysis id | `404` |
| `POST /analysis-tasks/:id/retry` | — | `202 { task }` | `404` · `409` not failed |
| `GET /candidates/:id/analysis` | — | `200` latest parsed analysis + `{provider, model, promptVersion, createdAt}` | `404` candidate/none |
| `POST /jobs/:id/rankings` | — | `201 { ranking }` (snapshot + items + excluded list) | `404` · `400` none analysed |
| `GET /jobs/:id/rankings` | — | `200 [{id, createdAt, candidateCount}]` | `404` |
| `GET /rankings/:id` | — | `200` full snapshot (criteria + items joined with names) | `404` |
| `GET /ai/catalog` | — | `200` providers × models for the active plan + disclosures | — |
| `GET /ai/settings` | — | `200 { provider, model }` | — |
| `PUT /ai/settings` | JSON `{ provider, model }` | `200` | `400` not in catalog/plan |
| `GET /ai/usage` | — | `200 { plan, allowance, used, events? }` (current month) | — |

Existing error mapping reused; no new status-code semantics.

## 11. UI (solid-foundation continuation, tokens.css)

- **`/settings` (new page + sidebar item):** plan card with **DEV MODE** banner; model picker
  grouped by provider — selecting shows `disclosureFor(provider)` inline and requires an
  explicit confirm before `PUT /ai/settings`; usage bar (used / allowance, advisory wording).
- **JobDetailPage:** candidates table gains an **Analysis** column (— · queued · running ·
  analysed · failed-with-reason + Retry); header gains "Analyse all new" and "Rank now"
  buttons; polling (reuse the 5s health-poll pattern) while tasks are queued/running; a
  **Rankings** section lists snapshots (newest first) linking to a snapshot view — ranked table
  (rank, name, score, reason) + criteria summary line ("factors used … · excluded …").
- **CandidatePage:** analysis panel — summary, recommendation badge, dimension cards
  (assessment + evidence quotes + confidence chip), factor scores, sensitive flags rendered as
  amber "must not be used for decisions" chips (F3.4), provider/model/prompt-version caption,
  Analyse/Re-analyse button; failed state shows "analysis unavailable — retry", never a score.
- Offline/no-key: analysis actions fail visibly with the `auth`/`network` message; everything
  else keeps working (PRD 11.2).

## 12. Cross-provider eval (PRD Phase 2 risk item)

`scripts/ai-eval.mjs` (dev-only, run manually with live keys): 5 synthetic resumes (one
containing age/marital-status lines) × 3 providers → asserts schema-valid output everywhere,
prints a factor-score comparison matrix, and checks the sensitive-resume run: flags present +
scores within tolerance of the same resume with the sensitive lines removed. Output saved to
`docs/superpowers/evals/2026-07-11-phase-2-eval.md` when run. **Requires all three keys — owner
runs it after adding `DEEPSEEK_API_KEY` and `ANTHROPIC_API_KEY` to `.env`.**

## 13. Testing (all offline; fixtures, never live keys)

| Test file | Covers |
|---|---|
| `tests/migration-0002.test.ts` | 0002 applies over 0001; tables + indexes exist; runner records id 2 |
| `tests/ai-schemas.test.ts` | AnalysisOutput accepts a full fixture; rejects missing evidence/ bad enum/ out-of-range score |
| `tests/ai-prompts.test.ts` | F8.5 text verbatim in system prompt; resume delimited + labelled untrusted; version constant present; boss-preference block only when present |
| `tests/ai-subscription.test.ts` | DevTokenIssuer env precedence + auth error when missing; settings validate against catalog/plan; defaults |
| `tests/ai-gateway.test.ts` | fixture fetch: happy path per adapter; 401→auth no-retry; 429→retry then success; timeout; invalid JSON → one re-ask → invalid_output; usage_events written incl. on validation failure |
| `tests/ai-adapters.test.ts` | request-shape per provider (json_schema / json_object / forced tool) against recorded fixture responses |
| `tests/ai-analyze.test.ts` | mock gateway: input_manifest correctness (with/without optional materials); versioned file + latest copy + row; rollback on fs failure; no-extracted-text failure |
| `tests/ai-queue.test.ts` | enqueue all-new/dedupe/skips; claim order; concurrency cap; failure recorded with code; boot reset running→queued; retry endpoint semantics |
| `tests/ranking.test.ts` | weight renormalisation; boss-preference all-or-none rule; exclusion recorded in criteria; tie-break determinism; snapshot shape; immutability triggers still abort; composition never reads sensitive_flags |
| `tests/ai-routes.test.ts` | full surface via `app.request`: 202 enqueue shapes, analysis fetch, ranking 400/201, settings 400 on off-catalog, usage aggregation |

Existing 71 tests must stay green. UI verified by the owner's manual walk (section 15).

## 14. Out of scope (Phase 2)

Interview flows and question generation (P3) · memory writes/learning (P3) · real vendor
subscription service, enforcement/at-cap behaviour, key TTL/rotation (vendor-service design
items) · streaming responses · OCR · email templates (P4) · encryption (P5) · queue
parallelism beyond 2 / cross-process workers.

## 15. Acceptance criteria (PRD Phase 2, made concrete)

1. Import 5 resumes → "Analyse all new" → every candidate shows a complete analysis: all F3.1
   dimensions, each with ≥1 evidence quote + confidence.
2. Switch provider in Settings → next analysis records the new provider + model in `ai_analyses`
   — zero feature-code changes (settings only).
3. Model selection shows the provider-risk disclosure before confirming (D-11).
4. A resume containing age/marital status → analysis carries "must not be used for decisions"
   flags; eval script shows scores unmoved vs the scrubbed twin; ranking code provably never
   reads the flags.
5. "Rank now" → snapshot matches the section 5.3 shape (criteria + per-candidate
   rank/score/reason); re-running appends a new snapshot; UPDATE/DELETE on snapshots abort.
6. Unanalysed candidates are listed as excluded from the run, never silently dropped.
7. Network unplugged (or key removed) → analysis tasks fail to a visible retryable state;
   jobs/candidates/rename/everything else keeps working; app restart with queued tasks resumes
   them.
8. Usage bar reflects recorded token usage against the dev-plan allowance (advisory).
