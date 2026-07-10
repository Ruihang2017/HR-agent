# Design — Data & memory

> Companion: `PRD.md` sections 7–8 (WHAT — wins on conflict) · `design-architecture.md` ·
> `design-workflows.md` | v1.0 · 2026-07-10 (D-28)
>
> Status tags: **Built (Phase N)** — shipped, detail in the phase spec; **Planned (Phase N)** —
> design intent, revised at that phase's design session.

## 0. One-line positioning

The data system is **file-first**: `~/jobpin-data/` holds every artifact as boss-readable,
boss-editable plain files — *the folder is the substance, SQLite is the index*. "Memory" (what
the AI accumulates about the boss's preferences and lessons) is a deliberate, consent-gated layer
on top: **propose → approve → write**, never silent learning.

## 1. Design goals

| Goal | Meaning |
|---|---|
| **Originals are sacred** | An uploaded resume is preserved verbatim forever; extraction/analysis failures never destroy or block access to it |
| **Transparency** | The boss can open the folder and read everything as Markdown/JSON; no proprietary blobs (candidate encryption in P5 is the one deliberate exception, D-17) |
| **Explainability** | Every AI conclusion is reconstructable: versioned analyses with inputs + reasoning; immutable ranking snapshots |
| **Consent** | Nothing enters long-term memory without explicit boss approval; discriminatory preferences are refused at the gate |
| **Isolation** | Three memory scopes (company / job / candidate) never bleed into each other |
| **Local-only** | One folder = the complete data set = the unit of backup, restore, and encryption |

## 2. Memory taxonomy

Mapped to the classic agent-memory model, honestly — a single-user desktop app doesn't need
everything a multi-tenant platform does:

| Class | Jobpin realisation | Status |
|---|---|---|
| **Working** | Deliberately none persisted — the UI is stateless over the local API; there are no long-running conversations to resume | By design |
| **Knowledge (SOT)** | Company assets: `values.md`, `boss_preferences.json`, AU lawyer-reviewed `legal_templates/` + `onboarding_templates/` (versioned + jurisdiction-tagged, D-16); per-job `references/` (interview rules, legal notes, company context) and `inject.md` | Built (P0 scaffold); consumed P2+ |
| **Entity** | `jobs` and `candidates` rows + their folders; `profile.json` per candidate (contact, source, extraction status) | Built (P1) |
| **Episodic / audit** | `ai_analyses` (provider, model, prompt version, inputs, reasoning — F3.2) · `rankings` + `ranking_items` (**immutable snapshots**) · `memory_events` (every memory write, with `approved_by_boss`) · `emails` / `documents` records | Schema built (P0); populated P2–P4 |
| **Procedural** | `question_bank.json` (per job) · versioned prompt assets (P2) · templates | Built (P1, seeded empty) |
| **Derived** | `resume_text.md` (extraction) · `ai_analysis.json` · interview summaries — regenerable; **never authoritative over the original it derives from** | Extraction built (P1) |

## 3. Physical layout — Built (P0–1)

The full tree is normative in PRD section 8.2; the shape:

```
~/jobpin-data/
  jobpin.db                    ← the index (13 tables)
  company/                     ← company memory scope (F1.4)
  jobs/<derived folder name>/  ← job scope: jd.md, inject.md, references/,
    │                            question_bank.json, learned_skills.md
    └── candidates/candidate_<id>/   ← candidate scope: original resume,
                                       resume_text.md, profile.json, …
```

- **13 tables** (P0 migration 0001): `jobs, candidates, candidate_documents, interviews,
  interview_questions, interview_answers, ai_analyses, rankings, ranking_items, emails,
  memory_events, documents, settings`. Field-level truth lives in
  `src/server/migrations/` and the Phase 0 spec — deliberately not restated here.
- **Relative forward-slash paths** in every `*_path` column; the folder is relocatable.
- **Folder naming** is derived, unicode-preserving, Windows-safe (illegal chars stripped,
  reserved device names guarded, 80-char cap, case-insensitive collision suffixing). The display
  name (`jobs.name`, UNIQUE) is never altered by derivation.
- **DB triggers make ranking snapshots immutable** — UPDATE/DELETE on `rankings`/`ranking_items`
  aborts at the DB layer (invariant 11.1-5). Enforced below the application, relaxed only by a
  deliberate P5 migration for candidate deletion.

## 4. Write paths — Built (P1) for jobs/candidates; Planned (P3) for memory

- **Job creation:** folder skeleton first, then the DB row; on insert failure the folder is
  removed (no orphan index entries; an orphan *folder* is tolerable, an orphan *row* is not).
- **Candidate creation:** DB transaction opens → candidate row (id) → `candidate_<id>` folder +
  files (original, `resume_text.md` on success, `profile.json`) → document row → commit; any fs
  failure rolls the transaction back and removes the partial folder.
- **Extraction never throws** — it returns `{text}` or `{error}`; failure marks the candidate
  `needs_review` with the reason in `profile.json`, original untouched.
- **Job rename** rewrites every stored path prefix in one transaction with fs compensation
  (D-26) — see `design-workflows.md` section 2.
- **Memory writes (P3):** the AI *proposes* additions to `learned_skills.md` (with evidence);
  nothing is written until the boss approves; every outcome — approved or rejected — lands in
  `memory_events` with `approved_by_boss`. Proposals encoding protected attributes are refused at
  the gateway (F7.3), not stored-and-hidden.

## 5. Read paths / context assembly — Planned (P2–3), design intent

What gets assembled into a model call, per analysis:

```
1. System prompt (F8.5 hard constraints, versioned)        → stable, prompt-cacheable
2. Job context: jd.md + inject.md + references/ + values   → delimited, labelled
3. Job memory: learned_skills.md + boss_preferences.json   → delimited, labelled
4. Candidate material: resume_text.md (or original text)   → delimited, UNTRUSTED
5. (interview loop, P3) prior Q&A + notes                  → delimited, labelled
```

- Resume/email content is **untrusted input**: always delimited, never merged into the system
  prompt.
- Every call records exactly which materials went in (F3.2) — provenance is the read path's
  audit trail.
- Stable layers (system prompt, references) are prompt-cache candidates; per-layer token budgets
  are a P2 design item.

## 6. Sensitive data — flag-and-exclude (D-5), every phase

- Protected attributes (age, gender, race, religion, marital/fertility, disability, nationality)
  and pseudo-signals (zodiac 星座, bazi 八字, MBTI) are **never decision inputs** — invariant
  11.1-2/3.
- If sensitive information appears in an input, it is marked **"must not be used for decisions"**
  — flagged and excluded, *not* redacted (the boss can still see their own data; the AI must not
  use it).
- The F8.5 system prompt carries these constraints verbatim; the P3 memory gate refuses
  discriminatory preference proposals.

## 7. Retention & protection

| Concern | Position | Status |
|---|---|---|
| Storage | Local forever; no cloud persistence of hiring data | Built (P0–1) |
| Deletion | Candidate deletion supported (F8.3) — the one operation allowed to touch snapshots, by migration-relaxed rules | Planned (P5) |
| Encryption | **Candidate data only** (D-17): `candidates/` trees + candidate-bearing DB content; company/job files stay plain for transparency | Planned (P5) |
| Backup | One folder = the backup unit (F8.4); format/destination at P5 design | Planned (P5) |
| Provider transit | Analysis sends necessary candidate content to the chosen provider at call time, stateless; disclosed at model selection + terms disclaimer (D-11) | Planned (P2) |

## 8. Deliberately not doing

- ❌ No emergent/cross-candidate learning of screening preferences — job memory comes only from
  boss-approved, evidence-backed proposals (F7.2/F7.3).
- ❌ No silent memory writes, no silent fact overwrites (memory events are the record).
- ❌ No free-text writes into structured stores — P2+ model output must pass schema validation.
- ❌ No cloud sync, no vendor transit of candidate content (D-12).
- ❌ No redaction pipeline — flag-and-exclude is the chosen mechanism (D-5).

## 9. Open questions (owned by future phase designs)

| # | Question | Phase |
|---|---|---|
| 1 | Encryption mechanism: key management, file-layer vs DB-layer, backup interaction | P5 |
| 2 | Company-memory vs job-memory precedence when they conflict in context assembly | P3 |
| 3 | Context token budgets per layer + drop priority when over budget | P2 |
| 4 | `candidates.status` full lifecycle vocabulary (currently `new` · `needs_review` only) | P2–3 |
