# Design — Architecture & components

> Companion: `PRD.md` (WHAT — wins on conflict) · `design-memory.md` · `design-workflows.md` ·
> `CONTEXT.md` (terms) | v1.0 · 2026-07-10 (D-28)
>
> **How to read the status tags.** **Built (Phase N)** = shipped and tested; the authoritative
> detail is the phase's design spec in `docs/superpowers/specs/`. **Planned (Phase N)** = design
> intent — enough to review and challenge, revised by that phase's design session before build.
> This document is revised at every phase design session.

## 0. Component panorama

| Component | Status | One-line responsibility |
|---|---|---|
| **Electron main process** | Built (P0) | App lifecycle, single-instance lock, window, hosts the local server, owns all fs/OS access granted to the UI |
| **Preload bridge** | Built (P0–1) | The only renderer↔main channel: 4 whitelisted IPC methods (`serverPort`, `appInfo`, `openDataFolder`, `openPath`) |
| **Renderer UI** (React + react-router) | Built (P1) | Everything the boss sees; talks to the server over local HTTP, never touches fs/DB directly |
| **Embedded HTTP server** (Hono) | Built (P0–1) | The app's API on `127.0.0.1:<os-assigned>`; routes → services; one error-mapping layer |
| **Service modules** (`src/server/`) | Built (P1) | Domain logic: `naming` · `jobs` · `candidates` · `extract` · `fsx`; Electron-free, dependency-injected, unit-tested |
| **SQLite index** (better-sqlite3) | Built (P0) | 13 tables; the *index* over the file store; migrations; ranking-immutability triggers |
| **File store** (`~/jobpin-data/`) | Built (P0–1) | The *substance*: every job/candidate artifact as boss-readable files; one folder = the complete data set |
| **Model gateway** | Planned (P2) | Single call site for all LLM work; provider adapters (OpenAI / DeepSeek / Anthropic); records provider+model+prompt-version per call |
| **Subscription client** | Planned (P2) | Activates the boss's plan, obtains short-lived scoped provider credentials (token issuance, D-12); no candidate content passes through it |
| **Vendor subscription service** | Planned (P2, vendor-side) | Plan auth, token issuance, metering; the only cloud component we run — never sees hiring data |
| **Template engine** | Planned (P4) | Email/document generation from local templates; renders, never sends |
| **Encryption & backup** | Planned (P5) | Candidate-data-only encryption at rest (D-17); one-folder backup/restore |

## 1. Execution model — Built (P0–1)

One desktop process family, everything local:

```
Electron main ──hosts──▶ Hono server on 127.0.0.1:0  (OS-assigned port)
     │                        │
     │ IPC (4 methods)        ├─ better-sqlite3 (synchronous, WAL)
     ▼                        └─ jobpin-data/ file store
Renderer (React) ──HTTP──▶ the same Hono server (port via preload IPC)
```

- **Renderer → HTTP only.** The UI is a plain HTTP client of the local API. The 4 IPC methods
  exist solely for things HTTP can't do (learn the port, open Explorer). This keeps the entire
  domain surface testable via `app.request()` without Electron.
- **Synchronous service layer.** better-sqlite3 is synchronous by design; services are too. For a
  single-user local app this is simpler and fast enough; the extraction pipeline (CPU-bound,
  async libraries) is the deliberate exception.
- **Startup is honesty-in-failure:** scaffold data folder → open/migrate DB → start server →
  window. Any failure = plain-language dialog + clean exit; never a half-initialized app.
- **Offline-first:** everything built so far works with no network at all. When AI lands (P2),
  *only* AI analysis/generation degrades — visibly, never with fabricated output.

## 2. Module boundaries (load-bearing rules)

These rules are enforced by review and tests; breaking one is a defect, not a style choice:

1. `src/server/` **never imports Electron** — services run under plain Node (and in tests).
2. All DB-stored paths are **relative, forward-slash** (`jobs/<folder>/jd.md`) — the data folder
   is relocatable; absolute paths appear only at the fs call site.
3. **Typed errors, mapped once**: services throw `ValidationError` / `NotFoundError` /
   `ConflictError`; a single `app.onError` maps them to 400/404/409. Routes never hand-craft
   error statuses (413 body-cap and 422 extraction-failure are route-level by nature).
4. **Files are the substance, the DB is the index** — write order and rollback per flow in
   `design-workflows.md`; a DB row must never point at a folder that doesn't exist.
5. Any renderer-supplied path that reaches the fs is resolved through **containment checks**
   (`resolveContainedPath`) — paths escaping `jobpin-data/` are rejected (security boundary,
   adversarially tested).
6. **No native modules** outside better-sqlite3 (extraction is pure JS: unpdf, mammoth) — every
   native module costs an Electron-ABI rebuild step and a packaging risk (D-23 lesson).

## 3. Error-handling philosophy

| Situation | Behaviour |
|---|---|
| Invalid input | 400 with a field-level message the UI shows inline |
| Unknown id | 404 |
| Name collision | 409, surfaced inline in the form |
| Upload > 20 MB | 413 |
| JD file text extraction fails | 422 (the boss picked the file *for its text*) |
| Resume extraction fails | **Not an error**: candidate saved, status `needs_review` + reason; original preserved |
| Unexpected | 500, logged; fs work sits inside try/rollback so no half-written entities |
| Startup failure | Dialog + clean exit |
| (P2) provider/auth failure | Visible "analysis unavailable — retry"; never a fabricated score |

Principle: **honesty under uncertainty** (PRD section 7). Failures are visible states the boss can
act on, never silent defaults.

## 4. AI layer — Planned (P2), design intent

The part most worth reviewing before build:

- **One gateway, no leaks.** Every model call goes through one gateway module; provider SDKs
  (OpenAI / DeepSeek / Anthropic) exist only behind its adapter interface. Feature code composes
  *prompts and schemas*, never provider calls. Switching models must touch zero feature code (D-9).
- **Structured output as the contract.** Every LLM node returns schema-validated JSON (+ evidence
  and confidence per conclusion, F3.3). Per-provider strategy: native JSON/tool modes where
  available, validate-and-retry otherwise. Nothing free-text ever writes to the DB.
- **Arithmetic in code, judgment in the model.** The ranking total (PRD section 5.3 formula) is
  computed by code from per-factor component scores the model supplies with reasons — the math is
  auditable, the LLM never emits an unexplained total.
- **Every call is provenance-logged**: provider, model, prompt version, input materials,
  reasoning → `ai_analyses` row + `ai_analysis.json` (F3.2). Prompts are versioned assets.
- **Credentials via token issuance (D-12):** the subscription client exchanges the boss's plan
  for scoped, budget-capped, short-lived provider keys; the app then calls providers **directly**
  — candidate content never transits vendor infrastructure. Vendor proxy remains a documented
  free-tier fallback only.
- **Cost tiering:** cheap models for mechanical extraction/classification; the upgraded tier for
  analysis and ranking judgment. Each LLM node is independently budgetable and testable.
- **Untrusted input discipline:** resume and email content is delimited context, never merged
  into the system prompt; the system prompt carries the F8.5 hard constraints verbatim.

## 5. Security & trust boundaries

- **Trust boundary = the OS user session** (single boss role). No app-level accounts; the only
  sign-in is subscription activation (P2).
- Server binds to `127.0.0.1` on an OS-assigned port — never exposed off-machine.
- Renderer is sandboxed (contextIsolation, no nodeIntegration); its capabilities are exactly the
  4 preload methods + local HTTP.
- Path containment on every renderer-supplied path (rule 5 above).
- Candidate PII: stays local (P0–1) → flagged-not-used in AI decisions (P2, flag-and-exclude,
  D-5) → encrypted at rest (P5, D-17). Provider-transit risk is disclosed at model selection with
  a liability disclaimer (D-11).

## 6. Toolchain & testing — Built (P0–1)

Single-package TypeScript (strict). electron-vite (dev/HMR + build) · electron-builder (NSIS,
Windows-only shipping, D-14) · Vitest. Two standing rules with sharp edges:
- **Electron-ABI rule (D-23):** `postinstall` runs `electron-rebuild -f -w better-sqlite3`; all
  tests run via `npm test` (Vitest under `ELECTRON_RUN_AS_NODE=1 electron`). `npx vitest` loads
  the wrong ABI and crashes.
- **Windows fs-retry (D-27):** directory renames use bounded EPERM/EBUSY/EACCES retry —
  antivirus/indexer races are a production reality, not a test artifact.

Test shape: services get unit suites against temp dirs (dependency-injected `{db, paths}`); the
HTTP surface is tested via `app.request()` + `FormData`; security boundaries get adversarial
suites. 71 tests / 12 files as of Phase 1.

## 7. What each component does NOT do

- **Server/services:** no Electron imports; no UI concerns; no network calls (until the P2
  gateway — and then only via the gateway).
- **Renderer:** no fs, no DB, no `require` — HTTP + 4 IPC methods, nothing else.
- **Model gateway (P2):** no hiring decisions — analysis and recommendations only (invariant
  11.1-1); no unlogged calls; no provider SDK types escaping its boundary.
- **Subscription service (P2):** never sees resumes, candidates, or analyses — plan auth and
  token issuance only (D-12).
- **The product as a whole:** never sends email (D-15); never auto-rejects or auto-decides;
  never stores hiring data in any cloud.

## 8. Open questions (Phase 2 design items)

| # | Question |
|---|---|
| 1 | Token-issuance mechanics: key TTL, rotation cadence, revocation on cancel, per-key budget caps |
| 2 | DeepSeek's thin budget/usage APIs — confirm controls or proxy DeepSeek only |
| 3 | Offline grace period for subscription validation (how long does AI keep working without re-auth?) |
| 4 | At-cap behaviour: hard stop vs upgrade prompt (D-13 deferred) |
| 5 | Per-provider structured-output strategy details (native JSON/tool modes vs validate-and-retry) |
| 6 | Gateway process placement: in-main vs `utilityProcess` isolation (adoptable later without rearchitecting, per D-22) |
