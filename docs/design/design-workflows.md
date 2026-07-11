# Design — Feature workflows

> Companion: `design-architecture.md` (components & rules — read first) · `design-memory.md`
> (what gets stored) · `PRD.md` sections 5–6 (WHAT — wins on conflict) | v1.0 · 2026-07-10 (D-28)
>
> Per-feature runbooks: what happens, in what order, what can fail, and what guards it.
> **Built (Phase N)** = shipped + tested (detail in that phase's spec); **Planned (Phase N)** =
> design intent for review, revised at that phase's design session.

## 0. Conventions (all workflows)

- Typed errors → one mapping: 400 invalid · 404 unknown · 409 conflict · 413 >20 MB · 422 JD
  extraction failed (see `design-architecture.md` section 3).
- Candidate status vocabulary today: **`new`** · **`needs_review`**. The fuller lifecycle
  (invited / interviewing / offered / …) arrives by migration when P2–3 design it.
- File-first write discipline: a DB row never points at a folder that doesn't exist; rollbacks
  remove partial work (details per flow).

## 1. Job workspace — Built (P1)

**Create** (`POST /jobs`):

| Step | What | Failure handling |
|---|---|---|
| 1 | Validate display name (non-empty) | 400 |
| 2 | Derive folder name: unicode kept, Windows-illegal chars stripped, reserved names guarded, 80-char cap, case-insensitive ` (2)` suffix on collision | — |
| 3 | Write the full skeleton: `jd.md`, `inject.md`, `references/` ×3, `question_bank.json`, `learned_skills.md`, `candidates/` | fs failure → folder removed, error surfaces |
| 4 | Insert `jobs` row (relative paths) | UNIQUE name → 409 (folder rolled back); other DB failure → folder rolled back |

**Rename** (`PATCH /jobs/:id`) — the riskiest built flow, hence D-26:

```
validate name (400/409, case-sensitive UNIQUE)
  → derive new folder name (collision-checked)
  → fast path: same folder name case-insensitively? → update jobs.name only, done
  → fs rename old→new           (renameSyncWithRetry — D-27, AV/indexer races)
  → ONE DB transaction:
       update jobs (name + 3 path columns)
       rewrite EVERY known path column by prefix match
         (candidate_documents ×2 + future columns on interviews/ai_analyses/emails/documents;
          prefix LIKE-escaped, ESCAPE '\')
  → on transaction failure: compensating fs rename back;
       if compensation ALSO fails: log both paths, rethrow the ORIGINAL DB error
```

Guarantee: after a rename, every stored path still resolves — candidate pages keep working with
candidates present (acceptance-tested).

**JD** (`PUT /jobs/:id/jd`): paste text or upload a file; files go through extraction first —
extraction failure is a 422 (the boss chose that file *for its text*), size cap 413. Success
writes `jd.md`.

## 2. Candidate intake — Built (P1)

Two entry paths, one persistence flow:

- **Upload** (multipart): name optional → defaults to the filename stem; original stored as
  `resume.<ext>` verbatim.
- **Paste** (JSON): name required (400 without); the pasted text becomes `resume.md` (treated as
  the original).

**Extraction pipeline** (`extract.ts` — *never throws*):

| Input | Engine | On failure |
|---|---|---|
| `.pdf` | unpdf (pdf.js, pure JS) | corrupt / empty-text ("scanned document?") → error string |
| `.docx` | mammoth (pure JS) | error string |
| `.txt` `.md` | UTF-8 read | — |
| anything else | — | "unsupported file type" |

**Persistence** (one transaction): candidate row (id first) → `candidate_<id>/` folder → files
(original · `resume_text.md` on success · `profile.json` with name/contact/source/extraction
status) → `candidate_documents` row → commit. Any fs failure: transaction rolls back, partial
folder removed.

**Guardrails:** the original is *never* lost — extraction failure produces a **visible**
`needs_review` candidate whose page explains why, with the original one click away (never a dead
end). Batch drops: each file succeeds/fails independently; failures are listed by name.

## 3. AI analysis & ranking — Built (P2, spec `2026-07-11-phase-2-ai-analysis-ranking-design.md`)

> Two conformance rules learned in the field (D-32): output-format instructions are
> **adapter-owned**, never in the shared prompt (forced tool-use conflicts with "respond with
> JSON" wording); and a job **must have a JD** before analysis — refused with a clear message,
> because judging JD-fit without a JD makes honest models return evidence-free judgments.

Per-candidate analysis — **explicit, queued, restart-safe**:

```
boss clicks "Analyse" / "Analyse all new"
  → enqueue analysis_tasks (dedupe vs queued/running; skip candidates
    without extracted text — reasons reported, nothing silent)
  → worker (concurrency 2; interrupted tasks re-queued at boot):
      gather context (design-memory §5: JD + inject + references + values
                      + preferences + learned_skills + resume_text — delimited, resume untrusted)
      → gateway call (zod-validated structured output; per-provider strategy;
                      one re-ask on invalid output; usage_events recorded)
      → persist: versioned analyses/analysis_<id>.json + ai_analysis.json (latest)
                 + ai_analyses row (provider, model, prompt version, input manifest — F3.2)
  → per-conclusion: evidence source + confidence (F3.3); no naked verdicts
  → sensitive info found in input → flagged "must not be used for decisions" (F3.4)
```

Ranking run — **explicit "Rank now"**:

```
latest analysis per candidate (unanalysed candidates listed as excluded, never silent)
  → total composed IN CODE from factor scores (section 5.3): weights renormalised over
    the factors present — interview_performance excluded until P3; boss_preference_match
    only when every included analysis has it
  → persist immutable snapshot: rankings (criteria = full recipe: factors, weights,
    exclusions, input analyses) + ranking_items {rank, score, reason}
  → UI shows ranked list; every rank explainable from its snapshot alone
```

**Failure runbook:** provider error / no network / auth lapse → task `failed` with a
human-readable code, visible "analysis unavailable — retry"; **never** a fabricated or
cached-as-fresh score. Schema-invalid output → one stricter re-ask → surfaced failure, not a
guess. App restart with queued work resumes it.

**Guardrails:** analysis is a recommendation — candidate status changes only by boss action
(invariant 11.1-1); protected attributes never rank — ranking composition provably never reads
`sensitive_flags` (11.1-2); every run snapshots (11.1-5); analysis never runs without an
explicit boss action (token spend is boss-controlled).

## 4. Interview loop & memory — Built (P3, spec `2026-07-11-phase-3-interview-loop-memory-design.md`)

> Settled at the P3 design session: `interview_performance` is scored **only from items the boss
> flagged affects-ranking** (none flagged → no factor); multiple simple rounds (latest round's
> score ranks); interview AI ops are **direct awaited gateway calls** (the queue stays
> analysis-only); ranking uses **per-candidate factor sets** (interviewed candidates score over
> six renormalised factors, others over five — recorded per candidate in the snapshot criteria);
> memory proposals are code-screened for protected attributes **before** the boss sees them.

- **Before:** generate questions in five categories (standard · resume-specific · JD-risk ·
  boss-favourite · follow-ups) from `question_bank.json` + `learned_skills.md` + preferences;
  unlawful/high-risk questions filtered (F5.2).
- **During (manual entry, MVP):** per item — question, answer, boss note, AI analysis,
  confidence, **affects-ranking flag**. Boss input is a signal, not gold truth (section 5.5).
- **After:** summary + soft-skill observations + stability inference + risks + next-round
  recommendation → **re-ranking = a new snapshot** (history preserved, F4.5).
- **Memory proposal flow (the consent gate):**

```
AI proposes job-memory updates (with evidence)
  → boss approves | rejects  (nothing writes without approval)
  → approved → learned_skills.md; either way → memory_events row (approved_by_boss)
  → proposals encoding protected attributes: REFUSED at the gateway with a visible
    reason (F7.3) — not stored, not hidden
```

**Open design item flagged early:** which interview items feed the "interview performance"
ranking factor (the affects-ranking semantics) needs crisp definition at P3 design.

## 5. Communications — Designed (P4+5 combined, spec `2026-07-12-phase-4-5-communications-data-protection-design.md`)

> Settled: Handlebars templates seeded from `templates/au/emails/` into boss-editable
> `company/email_templates/`; six types with per-type declared inputs; copy-to-clipboard, no
> send affordance of any kind; email files are candidate-tree files (encrypted by Part B).

Choose candidate → pick template type (online/onsite invitation, reschedule, rejection,
more-materials, onboarding) → render locally with job/candidate variables → save under the
candidate's `emails/` + `emails` row. **There is no send capability anywhere in the product**
(D-15) — the boss copies into their own mail client, which structurally satisfies
confirm-before-send. Engine choice (Handlebars vs md→PDF/DOCX) is a P4 design decision (F6.4).
Legal/onboarding documents (post-MVP, D-19/F6.3) additionally require human review before use.

## 6. Data protection — Designed (P4+5 combined, spec `2026-07-12-phase-4-5-communications-data-protection-design.md`)

> Settled: whole-DB encryption via the `better-sqlite3-multiple-ciphers` swap + AES-256-GCM
> candidate-file layer behind one `candidate-fs` seam; safeStorage-wrapped master key inside
> `jobpin-data/.keys/` (passphrase-upgrade seam documented); deletion = anonymise-in-snapshots
> for candidates (reason scrubbed, rank/score survive) + full cascade for jobs, both gated by
> in-transaction maintenance flags so invariant 11.1-5 holds for every other path; backups are
> passphrase-encrypted portable archives (plain zip only behind an explicit acknowledgement).

Candidate-only encryption at rest (D-17) · one-folder backup/restore (F8.4) · candidate deletion
(F8.3 — the deliberate, migration-relaxed exception to snapshot immutability) · job deletion
(deferred here by D-17's phase plan; rename shipped in P1 instead).

## 7. Cross-cutting guardrail summary

| Guardrail | Enforced where |
|---|---|
| Boss decides; AI recommends | No status-changing AI path exists; boss decision recorded separately from AI recommendation (F4.4) |
| Ranking snapshots immutable | **DB triggers** (below the application) |
| Originals never lost | Write-order + rollback discipline; extraction never-throws contract |
| Protected attributes never decide | Allow-listed ranking factors (5.3) + F8.5 system prompt + P3 memory gate |
| Nothing auto-sent | No send capability exists (D-15) |
| Candidate content never transits vendor | Token issuance, direct provider calls (D-12) |
| Paths can't escape the data folder | `resolveContainedPath` on every renderer-supplied path |
