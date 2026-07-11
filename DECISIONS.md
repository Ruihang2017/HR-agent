# Decisions

A dated, append-mostly log of the **major** decisions on this project and *why*, so any
developer can trace the reasoning and know what may be safely reversed. Newest first.

When a decision changes, add a **new** entry that supersedes the old one — mark the old one
`Superseded` and link forward. Don't rewrite history in place.

Format per entry: **Decision · Context · Alternatives · Rationale · Status**.

> Log reset 2026-07-09: entries from the former Shortlist product were cleared together with its
> implementation. They remain in git history at commit `db5e511`.

## Decision index

The canonical registry of decision IDs referenced throughout `PRD.md` and (eventually) the
codebase. D-1…D-6 were taken with the project reset and are fully specified here; D-7 onward each
also have a dated entry below.

| ID | Date | Decision | Rationale |
|---|---|---|---|
| **D-1** | 2026-07-09 | **Project reset.** The Shortlist implementation (Phase-1 web POC, cloud OpenAI) was removed; the Jobpin client spec became the new basis (later archived — D-8). Prior state preserved at commit `db5e511`. | Client meeting produced a fundamentally different product (local-first desktop, boss-only); realigning the old codebase would cost more than restarting. |
| **D-2** | 2026-07-09 | Stack per spec 2: Electron + Node.js local server + SQLite + local files + Handlebars/md→PDF templating. *(The model layer as originally minuted — a local Hermes build — is superseded by D-9.)* | Spec-mandated; local-first data is the product's identity, not an implementation detail. |
| **D-3** | 2026-07-09 | Frontend framework: **React** (spec offers React/Vue). | Team continuity — prior work was React + TypeScript; no spec conflict. |
| **D-4** | 2026-07-09 | Invariants adopted as product law (PRD section 11.1): boss decides / AI ranks; evidence + confidence on every conclusion; sensitive attributes flagged "not for decisions", never used; immutable ranking snapshots; propose→approve→write for memory. | Direct from spec 4.3/4.5/6/8/10; these shape every phase. |
| **D-5** | 2026-07-09 | Sensitive-information handling is **flag-and-exclude** ("must not be used for decisions"), not redaction. | Spec 8 defines the mechanism; differs deliberately from the previous product's identity-blind redaction. |
| **D-6** | 2026-07-09 | MVP scope cut exactly at spec 9: STT/TTS voice and legal-document (offer/contract) generation are **post-MVP**; MVP emails are templates only, nothing is ever auto-sent. *(Gmail, originally post-MVP here, was later descoped to a non-goal — D-15.)* | Spec 9 is explicit; spec 4 features not in spec 9 are sequenced after MVP. |
| **D-7** | 2026-07-09 | **English-first product language**: UI, templates, code, and repo docs in English. Chinese remains the client-meeting/minutes language only. | Owner decision — the spec's Chinese is a meeting artifact, not a product requirement. |
| **D-8** | 2026-07-09 | The client spec is **archived as meeting minutes** (`docs/meeting_minutes/2026-07-09-jobpin-technical-spec.md`) now that the PRD has absorbed it in full; the PRD returns to being the single source of truth. Future minutes are applied to the PRD by explicit update. | Owner decision — one living authority, provenance preserved verbatim. |
| **D-9** | 2026-07-09 | **Model layer: cloud LLM APIs behind a provider-abstraction gateway** — adapters for OpenAI, DeepSeek, and Anthropic (Claude); the customer switches provider/model in settings; provider + model recorded on every analysis *(credential handling superseded by D-10/D-12)*. The archived minutes' "local model / Hermes 魔改版本" line was a **minute-taking error** (owner correction, 2026-07-09): the *app and data* are local; the *model* is an API call. Resolves OQ-1 and OQ-3; amends the model-layer part of D-2. | Owner correction of the minutes; abstracting the model layer from day one keeps providers swappable and feature code provider-free. |
| **D-10** | 2026-07-09 | **Model access is subscription-based (Cursor-style).** The boss never supplies or manages API keys: they purchase a plan and select from the in-app model catalog that plan unlocks. Implies a vendor-side subscription service for auth/metering — delivery architecture settled by D-12, plans by D-13. Resolves OQ-10. | Owner decision — key management is unacceptable UX for a non-technical boss; subscriptions monetise model access cleanly. |
| **D-11** | 2026-07-09 | **Free provider choice + risk disclosure; no provider exclusions.** The boss may pick any offered provider; the app flags the data-transit risk (provider jurisdictions/data policies) at model selection, and the terms carry a liability disclaimer — the vendor is not liable for the boss's provider choice. Resolves OQ-11. | Owner decision — target users are too small for per-jurisdiction gating; disclose and disclaim instead of restrict. |
| **D-12** | 2026-07-09 | **Subscription delivery: token issuance, not a vendor proxy.** The vendor service authenticates the plan and provisions scoped, budget-capped, short-lived provider credentials; the app calls providers **directly** — candidate content never transits vendor infrastructure. Metering via provider budget caps + usage APIs (retrospective), key rotation/revocation on cancel. A vendor proxy is the documented fallback for the free tier only, if abuse demands hard enforcement. Implementation mechanics are Phase 2 design items. | Owner decision — preserves the local-data promise end-to-end; softer quota enforcement is an acceptable trade at this user scale. Rejected: full vendor proxy (hard enforcement, but resumes would transit vendor servers and the vendor becomes a latency/availability/compliance bottleneck). |
| **D-13** | 2026-07-09 | **Plans: two tiers.** (1) **Free** — limited token allowance, expires after 1 month. (2) **Pro** — A$20/month, larger token allowance. Exact allowances and at-cap behaviour (hard stop vs upgrade prompt) are Phase 2 design details. Resolves OQ-13. | Owner decision — simple two-tier entry, Cursor-style packaging. |
| **D-14** | 2026-07-09 | **OS targets: cross-platform-safe code, Windows-only shipping for MVP.** Electron makes the codebase portable, but each shipped OS costs installers, code signing (macOS additionally requires an Apple Developer account + notarization or Gatekeeper blocks the app), native-module prebuilds (SQLite), credential-store differences, and per-OS QA. MVP builds, signs, and supports **Windows only**; macOS is added post-MVP when a real user needs it — a packaging/signing task, not a port; Linux out of scope. Resolves OQ-2. | Electron portability is a property of the code, not of shipping; pay each OS's packaging tax only when a user exists. |
| **D-15** | 2026-07-09 | **Email-service integration (Gmail MCP/API) is a non-goal.** The product generates email *templates* only and never sends email; the boss sends from their own mail client. The minutes' optional-Gmail lines [spec 2, 4.2] are deliberately descoped — the actual requirement is templates. Supersedes the Gmail part of D-6; resolves OQ-4. | Owner reading of the client's intent; mailbox integration adds OAuth/consent/abuse surface with no MVP value, and templates-only structurally satisfies the confirm-before-send rule [spec 8]. |
| **D-16** | 2026-07-09 | **Australia-first market; developer-supplied, lawyer-reviewed template content.** Legal and onboarding template content is supplied by the development side and lawyer-reviewed, AU jurisdiction. Repo home: **`templates/au/legal/` and `templates/au/onboarding/`** — bundled as app defaults, copied to `jobpin-data/company/legal_templates/` and `onboarding_templates/` at runtime. Every template carries a version + jurisdiction tag (F6.3). Resolves OQ-6. | Owner decision; a fixed repo home means lawyer-reviewed content has a landing place before Phase 4 wires it. |
| **D-17** | 2026-07-09 | **Encryption scope: candidate data only.** The `candidates/` trees and candidate-bearing DB content are encrypted at rest (Phase 5); company/job files stay plain, preserving file-first transparency (PRD section 7). Mechanism (key management, file vs DB layer, backup format) is Phase 5 design. Resolves the scope half of OQ-7. | Owner decision — the PII lives in candidate data; the boss's own material stays boss-editable plain text. |
| **D-18** | 2026-07-09 | **Jobpin-platform integration is a non-goal** — no plugin, import/export bridge, or sync layer; the minutes' future-integration note [spec 1] is descoped. Resolves OQ-8. | Owner decision; zero coupling keeps the product independent. |
| **D-19** | 2026-07-09 | **Onboarding document generation (F6.2, spec task 13) is immediately post-MVP** — the first backlog item after MVP ships; PRD Phase 4 covers email templates only (spec task 12). Resolves OQ-9 in favour of the spec 9 MVP list. | Owner decision; matches the spec's MVP list exactly while keeping task 13 next in line. |
| **D-20** | 2026-07-09 | **PRD v2.7 cleanup:** decision log consolidated into this file (this index is the canonical D-registry); PRD Open-questions and Glossary sections removed (all resolved); "§" symbols replaced with plain section references; PRD sections renumbered (Implementation plan → 10, Cross-cutting → 11); DB key fields rendered as a code block. | Owner directive — one home per kind of content; "§" was unreadable to the team; duplicated decision content in two files invites drift. |
| **D-21** | 2026-07-10 | **`jobpin-data/` lives in the user's home folder** (e.g. `C:\Users\<boss>\jobpin-data`), with the SQLite DB inside it (`jobpin-data/jobpin.db`) — one folder is the complete data set. | Visible (file-first transparency) yet outside OneDrive's default sync scope — a Documents location would silently sync candidate PII to the cloud on many Windows 11 machines, breaking the local-only invariant; one folder makes backup/restore (F8.4) trivial. Rejected: Documents (OneDrive trap), AppData (hidden — kills transparency), first-run picker (unneeded UX for MVP). |
| **D-22** | 2026-07-10 | **Phase 0 foundation stack (Approach A):** single-package TypeScript project; electron-vite (dev/build) + electron-builder (NSIS Windows installer); **Hono** HTTP server hosted in the Electron main process, bound to `127.0.0.1:0` (OS-assigned port, handed to the renderer via preload IPC); **better-sqlite3**; numbered SQL-file migrations tracked in a `migrations` table; single-instance lock. | Shortest path to Phase 0 acceptance with industry-standard parts and the best dev loop; nothing blocks later upgrades (utilityProcess isolation, an ORM) without rearchitecting. Rejected: Electron Forge all-in-one (rougher Vite integration, clunkier Squirrel installer); utilityProcess + Fastify + Drizzle now (more moving parts than the skeleton needs). |
| **D-23** | 2026-07-10 | **Native-module rebuilds via @electron/rebuild** — `postinstall: electron-rebuild -f -w better-sqlite3` keeps `node_modules` on the Electron ABI; all tests run through `ELECTRON_RUN_AS_NODE=1 electron` (`npm test`), never `npx vitest`. Standing choice, kept after any Node upgrade. | `electron-builder install-app-deps` (the plan's original hook) crashes on Node < 22.12 (needs default `require(esm)`); @electron/rebuild is narrower, faster, and tests then exercise the exact native binary that ships. |
| **D-24** | 2026-07-10 | **Temporary workaround:** the `dist` script carries `NODE_OPTIONS=--experimental-require-module` so electron-builder packages on the dev machine's Node 22.11. **Remove once the machine runs Node ≥ 22.12** (flag becomes default behaviour); README notes it. | Unblocks Windows packaging today without forcing an immediate machine-level Node upgrade. |
| **D-25** | 2026-07-10 | **Documentation-system adoption, right-sized.** Adopted from `docs/reference/DOC-SYSTEM-SPEC.md`: standalone `CONTEXT.md` glossary; PRD slimmed to WHAT with pointers to design docs (fixing live schema drift in 8.1); README rebuilt as navigation hub; superseded banner on archived minutes; companion headers on design specs. **Deliberately not adopted, with triggers:** per-file `docs/adr/` split (DECISIONS.md works — revisit at ~40+ entries or when deep-linking is needed); Wide component-overview doc (trigger: Phase 2–3, when gateway/subscription/memory boundaries blur); Deep state-runbook doc (trigger: candidate/interview lifecycles get designed); relocating PRD into docs/; restructuring CLAUDE.md (stays a generic process contract — product red lines remain PRD section 11.1, already numbered and cited from code). | The spec's own right-sizing rule: split on pain, not aspiration — and record which files earned their place. |
| **D-26** | 2026-07-10 | **Transactional job rename (Phase 1):** filesystem rename first (retry-wrapped), then one DB transaction updating the job row and rewriting every known path column by LIKE-escaped prefix match (`ESCAPE '\'`); on DB failure a compensating rename restores the folder (a compensation failure is logged with both paths and the **original** DB error is rethrown). Display renames that derive the same folder name case-insensitively skip the fs rename and path rewrite entirely. | fs-first is recoverable by compensation; DB-first would leave rows pointing at a folder that never moved. LIKE-escaping stops folder names containing `%`/`_`/`\` from rewriting other jobs' rows. NTFS is case-insensitive — a case-only "rename" must not be treated as a folder move. |
| **D-27** | 2026-07-10 | **Windows fs-retry policy (Phase 1, standing):** directory renames go through `renameSyncWithRetry` (`src/server/fsx.ts`) — bounded retry (10 × 50 ms, `Atomics.wait` sync sleep) on `EPERM`/`EBUSY`/`EACCES`; test teardown uses the matching `rmrfWithRetry`. | Antivirus/search-indexer briefly locks freshly created folders on Windows; unretried renames flaked at ~25–50% in Phase 1 test runs (pre-existing, proven not introduced by the feature). Real boss machines run AV — this is product hardening, not test convenience. |
| **D-28** | 2026-07-10 | **Technical design layer adopted at `docs/design/`** — `design-architecture.md` (components & boundaries), `design-memory.md` (data & memory), `design-workflows.md` (feature runbooks) — published on the docs portal and listed as PRD companions. *Partially supersedes D-25:* the "Wide component-overview doc" trigger (Phase 2–3) fired early. Drift control: per-section status tags (Built / Planned), built sections point to phase specs, PRD wins on conflict, docs revised at each phase design session. | The manager reviewing the portal needs the HOW layer to give technical input **before** Phase 2 is built; per-phase specs are per-slice records with no cross-phase overview a reviewer can read in one sitting. |
| **D-29** | 2026-07-11 | **Phase 2 architecture: queue-first, raw-HTTP adapters, no provider SDKs.** All model calls go through one gateway with hand-written `fetch` adapters (OpenAI `json_schema` strict · DeepSeek `json_object` + schema-in-system · Anthropic forced tool-use); analyses execute through a restart-safe DB-backed queue (`analysis_tasks`, concurrency 2, boot recovery re-queues interrupted work). `zod` is the only new dependency. | Owner chose Approach C. No SDKs = no type leakage through the gateway boundary, trivial fixture testing, zero SDK version churn; the queue survives app restarts and keeps batch analysis observable and retryable. |
| **D-30** | 2026-07-11 | **AI actions are explicit; ranking composition rules fixed.** Analysis ("Analyse" / "Analyse all new") and ranking ("Rank now") only run on a boss click — no automatic token spend. Ranking: weights `jd_fit .35 · key_skills .25 · relevant_experience .20 · growth_trajectory .10 · boss_preference_match .10`; factors without data are **excluded and the remaining weights renormalised to sum 1** (`interview_performance` excluded until Phase 3; `boss_preference_match` participates only when **every** included analysis has it); every exclusion recorded in the snapshot's `criteria`; unanalysed candidates reported, never silently dropped. | Owner decisions at design time — boss-controlled cost, honest scores over formula-shape stability (zero-filling absent factors would deflate scores misleadingly), and cross-candidate comparability beats per-candidate completeness. |
| **D-31** | 2026-07-11 | **Subscription stubbed behind a `TokenIssuer` seam + advisory local metering.** The vendor service doesn't exist yet: `DevTokenIssuer` reads `.env` keys under a fake Pro plan; every gateway call records `usage_events`; the Settings page shows usage vs the D-13 allowances **advisory-only, dev-stub numbers, no enforcement**. Model-catalog ids are code constants (verified at live smoke; one-line edits when they churn). | Owner chose stub + local metering. The interface is the seam where real token issuance (D-12) lands without touching feature code; advisory numbers approximate the real UX without building throwaway enforcement. |
| **D-32** | 2026-07-11 | **Adapter-owned output-mode instructions; a JD is required before analysis.** The shared analysis prompt carries no output-format instruction — each adapter appends its own (JSON-object wording for OpenAI/DeepSeek, "call the tool once with a complete input" for Anthropic). Analysing a job with an empty `jd.md` is refused with a clear message at both the enqueue and the pipeline. | Post-eval debugging root causes: the shared "respond with a single JSON object, no prose" line conflicted with Anthropic's forced tool-use and produced malformed tool input (live-verified both ways); an empty JD made honest models return empty evidence arrays that the schema (rightly) rejects — analysing JD-fit without a JD is a meaningless task, refused upfront. Also learned: claude-sonnet-5 rejects assistant-prefill, so prefill-based JSON extraction is not viable. |

---

### 2026-07-11 — Phase 2 architecture: queue-first gateway with raw-HTTP adapters (D-29) and explicit AI actions + composition rules (D-30)
**Decision:** Phase 2's two structural calls, both owner-made at the design session:
1. **D-29 — Approach C, "queue-first, no SDKs".** One gateway is the single call site for all
   LLM work; its three provider adapters are hand-written over raw `fetch` (OpenAI strict
   `json_schema` · DeepSeek `json_object` with the schema described in the system text +
   gateway validate-and-retry · Anthropic forced tool-use). Analyses run through a restart-safe
   queue: `analysis_tasks` rows claimed atomically, worker concurrency 2, interrupted tasks
   re-queued at boot, failures stored with typed error codes and retried only by explicit boss
   action. `zod` is the only new dependency.
2. **D-30 — explicit actions; fixed composition rules.** Nothing spends tokens without a boss
   click. Ranking totals are composed in code from per-factor scores: absent factors are
   excluded and remaining weights renormalised (interview_performance arrives in Phase 3;
   boss_preference_match is all-or-none across a run for comparability); the snapshot's
   `criteria` records factors, weights, exclusions, and the exact input analyses.
**Alternatives:** official SDKs behind the same interface (rejected — three dependencies, type
leakage pressure, uglier fixture testing); a gateway framework (rejected — abstraction mismatch,
less provenance control); synchronous per-request analysis with UI-orchestrated batches
(rejected by owner in favour of restart resilience); auto-analysis on intake (rejected — silent
token spend); zero-filling absent ranking factors (rejected — misleadingly deflated scores).
**Status:** Active. D-29/D-30 (index above); spec section 2/6/8/9.

### 2026-07-11 — Subscription dev-stub: TokenIssuer seam + advisory metering (D-31)
**Decision:** Until the vendor subscription service exists, model credentials come from a
`TokenIssuer` interface with a dev implementation reading `.env` keys under a stub Pro plan.
Every gateway call inserts a `usage_events` row from provider-reported usage; the Settings page
shows month-to-date usage against the D-13 allowances, clearly labelled advisory with dev-stub
numbers and no enforcement. Model-catalog ids live as code constants.
**Context:** Owner chose "stub + local metering" over interface-only or building the vendor
service now. The real token-issuance client (D-12) replaces `DevTokenIssuer` behind the same
seam; at-cap behaviour, TTL/rotation/revocation, DeepSeek's thin metering APIs, and real
allowances remain vendor-service design items.
**Alternatives:** interface + stub without metering (rejected — loses the usage-visibility UX);
building a minimal vendor service now (rejected — new hosted subsystem out of Phase 2 scope).
**Status:** Active. D-31 (index above).

### 2026-07-11 — Provider-conformance lessons: adapter-owned output instructions; JD required (D-32)
**Decision:** (1) The shared analysis prompt no longer carries any output-format instruction —
each adapter appends the wording its transport needs (Anthropic's forced tool-use gets "report
your analysis by calling the tool exactly once with a complete input object"). (2) Analysis of a
job whose `jd.md` is empty is refused with `ValidationError('job has no JD - add a job
description before analysing')` at both the enqueue and the pipeline (defence in depth).
**Context:** The owner's first cross-provider run failed on DeepSeek and Anthropic in-app while
OpenAI "worked". Systematic debugging found two independent root causes: the shared "respond
with a single JSON object — no prose" instruction made Claude emit malformed tool input
(missing keys, nested objects serialized as strings — reproduced and fix-verified live on
claude-sonnet-5); and the test job's empty JD made honest models return empty evidence arrays
that the schema's evidence-per-conclusion rule (F3.3) rightly rejects — OpenAI had only
"succeeded" by conjuring JD-fit evidence from the resume alone. Also established:
claude-sonnet-5 rejects assistant-message prefill, ruling out prefill-based JSON extraction.
**Alternatives:** relaxing the evidence-min-1 schema rule (rejected — weakens F3.3; the true
defect was asking an impossible question); text-mode + prefill for Anthropic (not viable —
prefill rejected by the model); coercing stringified tool fields (rejected — patches the symptom).
**Verification:** eval went 12/15 → 14/15 with the remaining Anthropic cell a probed 2/2-pass
nondeterministic flake covered in-app by the gateway's corrective re-ask; owner's full manual
walk then passed on all three providers.
**Status:** Active. D-32 (index above); recorded in the Phase 2 handover.

### 2026-07-10 — Technical design layer at `docs/design/` (D-28, partially supersedes D-25)
**Decision:** Adopt a maintained technical design layer at `docs/design/`, published on the docs
portal and listed as a PRD companion: `design-architecture.md` (component panorama, execution
model, boundaries, error philosophy, AI-layer design intent), `design-memory.md` (file-first data
& memory system), `design-workflows.md` (per-feature runbooks, built and planned). This partially
supersedes **D-25**, whose "deliberately not adopted" list deferred a Wide component-overview doc
with trigger "Phase 2–3, when gateway/subscription/memory boundaries blur" — the trigger fired
early and for a different reason: stakeholder review.
**Context:** The owner's manager reviewed the docs portal, endorsed the PRD staying requirements-
only, and asked for a technical layer showing *how* each part will be achieved so he can make
technical suggestions **before** Phase 2 build time. Owner concurred (2026-07-10), accepting the
known drift risk.
**Drift control (the price of adoption):** every section carries a status tag — **Built (Phase
N)** sections summarise and point to the authoritative phase spec; **Planned (Phase N)** sections
are design intent that the phase's design session revises before build. On any conflict the PRD
wins (CLAUDE.md rule 1). Revising `docs/design/` is a standing item of every phase design session
(recorded in the Phase 1 handover pick-up notes).
**Alternatives:** Per-phase specs only (rejected — per-slice records, no cross-phase overview a
reviewer can read in one sitting); a single monolithic design doc (rejected — the manager's
reference set from a sibling project splits architecture / memory / workflows, and that split maps
cleanly onto Jobpin); waiting for the D-25 trigger (rejected — the review value exists now, before
Phase 2 spends effort).
**Status:** Active. PRD v2.12 lists the companions; portal sidebar carries a Design section.

### 2026-07-10 — Phase 1 implementation decisions: transactional rename (D-26) + Windows fs-retry policy (D-27)
**Decision:** Two implementation decisions from Phase 1 execution:
1. **D-26 — transactional job rename.** `renameJob` renames the folder **first** (retry-wrapped),
   then runs one DB transaction updating `jobs.name/folder_path/jd_path/inject_path` and rewriting
   every known path column (`candidate_documents.file_path`/`.extracted_text_path`, plus the
   currently-empty future columns on `interviews`, `ai_analyses`, `emails`, `documents`) by prefix
   match — the prefix is LIKE-escaped and matched with `ESCAPE '\'` so folder names containing
   `%`, `_`, or `\` cannot corrupt other jobs' rows. If the transaction fails, a compensating
   rename restores the folder; if *that* also fails, the divergence (both paths) is logged and the
   **original** DB error is rethrown — the root cause is never masked. Fast path: if the new
   display name derives the same folder name case-insensitively, the folder is untouched and only
   `jobs.name` changes.
2. **D-27 — Windows fs-retry policy (standing).** Directory renames go through
   `renameSyncWithRetry` (`src/server/fsx.ts`): bounded retry — 10 attempts, 50 ms apart via
   `Atomics.wait` (synchronous, matching the better-sqlite3 sync service layer) — on
   `EPERM`/`EBUSY`/`EACCES`. Test teardown uses the matching `rmrfWithRetry` (`tests/helpers.ts`).
**Context:** Phase 1 Tasks 3/5. Windows antivirus/search-indexer briefly locks freshly created
folders; unretried renames flaked at ~25–50% per run (proven pre-existing, not introduced by the
feature). The compensation-masking fix was the final whole-branch review's one pre-merge code item.
**Alternatives:** DB-first rename (rejected — an fs failure would leave DB rows pointing at a
folder that never moved; fs-first is recoverable by compensation). Path columns derived by join on
job id instead of stored prefixes (rejected for Phase 1 — schema change, and stored relative paths
are the file-first convention). Async retry via `setTimeout` (rejected — the service layer is
deliberately synchronous). `graceful-fs` dependency (rejected — one narrow pattern doesn't justify
patching all of `fs`).
**Status:** Active. D-26/D-27 (index above); recorded in the Phase 1 handover.

### 2026-07-10 — Documentation-system adoption, right-sized (D-25)
**Decision:** Apply the structure and disciplines of the portable documentation-system spec
(archived at `docs/reference/DOC-SYSTEM-SPEC.md`) to this project — adopting only what its size
justifies. **Adopted:** standalone `CONTEXT.md` glossary (definitions + canonical terms with
_Avoid_ lists — notably "client minutes", never "the spec"); PRD sections 8.1/9/10-Phase-0
slimmed to WHAT with explicit pointers to the Phase 0 design spec (this fixed a live drift:
PRD 8.1 was missing `rankings.criteria`, which shipped); README rebuilt as the navigation hub
(directory tree, doc map, reading paths, decision-registry pointer, open-questions line);
superseded-banner prepended to the archived minutes (verbatim body untouched; the file's
read-only protection was preserved); companion headers on design specs.
**Deliberately not adopted, with re-visit triggers:** per-file `docs/adr/` (DECISIONS.md serves
the WHY concern; trigger ≈ 40+ entries); Wide component-overview design doc (trigger: Phase 2–3
multi-component boundaries); Deep state-runbook doc (trigger: candidate/interview lifecycle
design); moving `PRD.md` into `docs/` (pure churn); restructuring `CLAUDE.md` into product
red-lines (would reverse the 2026-07-09 governance decision; the spec's real requirement —
numbered, single-home, citable invariants — is met by PRD section 11.1, which code already cites).
**Context:** Owner supplied the spec from a sibling project with an assess → right-size →
migrate process; migration plan M1–M7 approved 2026-07-10.
**Alternatives:** Full adoption of every file in the spec (rejected — the spec itself warns
against splitting before the pain); no adoption (rejected — the duplication audit found real
drift: stale schema in PRD 8.1, a stale "no repository code" line, stack facts in four places).
**Rationale:** One concern, one home, wired by pointers; the not-adopted list is on record so
future sessions know these were choices, not oversights.
**Status:** Active. PRD v2.10.

### 2026-07-10 — Phase 0 toolchain: @electron/rebuild postinstall (D-23) + Node 22.11 packaging flag (D-24)
**Decision:** Two related implementation decisions from Phase 0 execution:
1. **D-23 (standing):** native-module rebuilds run via `@electron/rebuild`
   (`postinstall: electron-rebuild -f -w better-sqlite3`), keeping `node_modules` on the
   **Electron ABI** at all times; consequently every test run goes through
   `ELECTRON_RUN_AS_NODE=1 electron` (`npm test`) — running `npx vitest` directly loads the
   wrong ABI and crashes. This replaces the plan's `electron-builder install-app-deps` hook and
   stays even after a Node upgrade.
2. **D-24 (temporary):** the `dist` script carries `NODE_OPTIONS=--experimental-require-module`
   so electron-builder itself runs on the dev machine's Node 22.11. Delete the flag (and the
   README note) once the machine is on Node ≥ 22.12, where `require(esm)` is default.
**Context:** During Phase 0 Task 1, `electron-builder install-app-deps` crashed with
`ERR_REQUIRE_ESM` on Node 22.11.0 — electron-builder's dependency chain requires `require(esm)`,
default only from Node 22.12. `@electron/rebuild` worked despite its engine warning; the
packaging CLI needed the experimental flag.
**Alternatives:** Upgrading Node immediately (deferred — machine-level change, not needed to ship
Phase 0; still recommended); pinning an older electron-builder (rejected — chasing version
archaeology instead of a one-line flag).
**Rationale:** Ship Phase 0 on the machine as it is; keep the temporary part clearly labelled
with its removal condition.
**Status:** Active. D-23 standing; D-24 active-temporary (remove at Node ≥ 22.12). Recorded in
the Phase 0 handover.

### 2026-07-10 — Phase 0: data location in the user's home folder (D-21)
**Decision:** `jobpin-data/` is created directly in the user's home folder
(`C:\Users\<boss>\jobpin-data`), with the SQLite database inside it (`jobpin-data/jobpin.db`).
One folder is the complete data set — the unit of backup, restore, and (Phase 5) encryption.
**Context:** Phase 0 design session. The obvious-looking choice (Documents) hides a trap: on many
Windows 11 machines Documents is OneDrive-redirected, so candidate PII would silently sync to
Microsoft's cloud — breaking PRD invariant 11.1-8 without anyone noticing.
**Alternatives:** Documents (rejected — OneDrive trap); Electron `userData`/AppData (rejected —
hidden, kills file-first transparency); first-run folder picker (rejected — adds first-run UX and
move/migration edge cases the MVP doesn't need; a settings override can come later).
**Rationale:** Home folder is visible, discoverable, OneDrive-safe by default, and trivially
backupable.
**Status:** Active. D-21 (index above); PRD section 8.2 updated.

### 2026-07-10 — Phase 0 foundation stack: Approach A (D-22)
**Decision:** Single-package **TypeScript** project scaffolded with **electron-vite**
(`src/main`, `src/preload`, `src/renderer`, `src/server`); **electron-builder** producing an NSIS
Windows installer (D-14); **Hono** HTTP server hosted in the Electron main process, bound to
`127.0.0.1:0` — the OS assigns a free port, eliminating collision handling — with the port handed
to the renderer via preload IPC; **better-sqlite3** (synchronous API suits a single-user local
app) with numbered SQL-file migrations tracked in a `migrations` table; Electron single-instance
lock.
**Context:** Phase 0 design session; PRD section 10 Phase 0 deferred installer tooling, migration
mechanism, and port policy to this design.
**Alternatives:** Electron Forge all-in-one (rejected — its Vite plugin is rougher than
electron-vite and Squirrel installers are clunkier than NSIS); utilityProcess-hosted server +
Fastify + Drizzle ORM (rejected for now — crash isolation and typed schema are real benefits but
more moving parts than a skeleton needs; both are adoptable later without rearchitecting).
**Rationale:** Boring, industry-standard parts; best dev loop; shortest path to the Phase 0
acceptance criteria ("fresh install → app opens", 13 tables, offline).
**Status:** Active. D-22 (index above); PRD section 9 stack + Phase 0 brief updated.

### 2026-07-09 — PRD v2.7 cleanup: decision log consolidated here (D-20)
**Decision:** The PRD's "Key decisions log" section moved into this file — the **decision index
above is now the canonical D-number registry** (D-1…D-6 had previously been specified only in the
PRD's table). The PRD's Open-questions and Glossary sections were removed (every question is
resolved; the resolutions are recorded in the entries below), all "§" symbols in the PRD were
replaced with plain section references, the PRD's remaining sections were renumbered
(Implementation plan → 10, Cross-cutting concerns → 11), and the DB key-field list became a code
block.
**Context:** Owner directive — the team found "§" unreadable, and holding decision content in two
files invited drift.
**Alternatives:** Keeping a summary table in the PRD alongside this log (rejected — two homes for
the same content drift apart).
**Rationale:** One home per kind of content: requirements and plan in the PRD, decisions here,
minutes in `docs/meeting_minutes/`.
**Status:** Active. PRD v2.7.

### 2026-07-09 — Scope close-out: all remaining open questions resolved (D-15…D-19)
**Decision:** Five owner scoping calls, closing every open question in the PRD:
1. **Gmail integration → non-goal (D-15).** The minutes' optional Gmail MCP/API lines are
   descoped — the actual requirement is email *templates*. The product never sends email; the
   boss sends from their own mail client (which structurally satisfies the spec 8
   confirm-before-send rule). Supersedes the Gmail half of D-6.
2. **AU-first, developer-supplied templates (D-16).** Legal/onboarding template content is
   supplied by the development side and lawyer-reviewed. Repo home: `templates/au/{emails,
   onboarding,legal}/` (README added) — bundled as app defaults, copied into
   `jobpin-data/company/…` at runtime. Every template versioned + jurisdiction-tagged.
3. **Encryption scope: candidate data only (D-17).** `candidates/` trees + candidate-bearing DB
   content encrypted at rest; company/job files stay plain (file-first transparency preserved).
   Mechanism (keys, layer, backup format) at Phase 5 design.
4. **Jobpin-platform integration → non-goal (D-18).** No plugin, import/export bridge, or sync.
5. **Onboarding document generation → immediately post-MVP (D-19).** Phase 4 = email templates
   only (spec task 12); task 13 becomes the first backlog item — matching the spec 9 MVP list.
Additionally, **OQ-12 is closed into Phase 2 design**: the architecture (D-12) and tiers (D-13)
are set; key TTL/rotation, per-provider budget APIs, abuse controls, and at-cap behaviour are
engineering design items listed in the Phase 2 brief, not open product questions.
**Context:** Owner directives, 2026-07-09. With these, the PRD has **zero open questions**;
Phase 0 can start.
**Alternatives:** Keeping Gmail/Jobpin integration as post-MVP backlog items (rejected — "not
scheduled" reads as "coming"; non-goal is the honest label until an explicit re-scope); scheduling
onboarding docs inside MVP Phase 4 (rejected — the spec 9 MVP list names only the email).
**Rationale:** Cut integration surface to essentials, match the spec's MVP list exactly, encrypt
what carries PII while keeping the boss's own files editable, and give lawyer-reviewed content a
fixed landing place before it is needed.
**Status:** Active. D-15…D-19 (index above); the PRD's open-questions section then read "None"
and was removed entirely in the v2.7 cleanup (D-20).

### 2026-07-09 — OS targets: cross-platform-safe code, Windows-only shipping for MVP
**Decision:** The Electron codebase is kept **cross-platform-safe** (no Windows-only path,
process, or credential assumptions; cross-platform Electron APIs like `safeStorage` for secrets),
but the MVP **builds, signs, and supports Windows only**. macOS is added post-MVP when a real
mac-using customer appears — at that point it is a packaging/signing task (installer target,
Apple Developer account, notarization, mac QA), not a port. Linux is out of scope for the boss
persona.
**Context:** Owner question resolving PRD OQ-2 ("Electron is compatible with all OS, right?").
Electron makes the *code* portable; it does not make *shipping* free — each supported OS costs
per-release installers, code signing (macOS requires Apple Developer membership + notarization or
Gatekeeper blocks the app), native-module prebuilds (SQLite), and per-OS QA.
**Alternatives:** Ship Windows + macOS in MVP (rejected for now — pays the mac packaging tax with
no known mac user; easily reversed later); non-Electron native stacks (never in scope — spec
mandates Electron).
**Rationale:** Pay each OS's shipping cost only when a user exists, while keeping the reversal
cheap by writing portable code from day one.
**Status:** Active. D-14 (index above); resolves OQ-2.

### 2026-07-09 — Subscription delivery: token issuance, not a vendor proxy
**Decision:** The subscription service delivers model access by **token issuance**: it validates
the boss's plan and provisions scoped, budget-capped, short-lived provider credentials; the app
then calls OpenAI/DeepSeek/Anthropic **directly**. Candidate content never transits vendor
infrastructure — in either direction. Metering uses provider-side budget caps plus usage APIs
(retrospective); keys rotate on short TTLs and are revoked on cancel.
**Context:** Owner decision after reviewing both architectures. In both models the vendor owns
the provider accounts and pays the bills; the difference is the data path and the enforcement
point.
**Alternatives:** Full vendor proxy — app → vendor gateway → provider (rejected: hard real-time
quota enforcement and unextractable keys, but every resume would transit vendor servers, killing
the product's local-data promise, adding a latency/availability bottleneck, and giving the vendor
a PII compliance surface). Kept as a **documented fallback for the free tier only**, if
disposable-install abuse ever demands hard enforcement.
**Rationale:** Preserves "candidate data never touches our infrastructure" end-to-end; the cost —
softer, retrospective quota enforcement and briefly-extractable keys — is acceptable at this user
scale and mitigated by tight per-key budgets and rotation.
**Known risk:** per-provider admin/budget API support is uneven — DeepSeek's controls are the
thinnest; Phase 2 must confirm or proxy DeepSeek only.
**Status:** Active. D-12 (index above); implementation mechanics live in the PRD Phase 2 brief.

### 2026-07-09 — Plans: Free (limited, 1 month) + Pro (A$20/month)
**Decision:** Two subscription tiers at launch: **Free** — limited token allowance, expires after
one month; **Pro** — A$20/month with a larger token allowance. Exact allowances and at-cap
behaviour (hard stop vs upgrade prompt) are Phase 2 design details.
**Context:** Owner decision resolving PRD OQ-13; Cursor-style packaging on top of D-10/D-12.
**Alternatives:** More tiers / usage-based billing (deferred — start simple, revisit with real
usage data).
**Rationale:** A free on-ramp for trial plus one simple paid tier matches a small-business,
low-touch sales motion.
**Status:** Active. D-13 (index above).

### 2026-07-09 — Model access: subscription-based, Cursor-style (no user API keys)
**Decision:** The boss never supplies or manages API keys. Model access is sold as a
**subscription**: the boss purchases a plan and selects from the in-app **model catalog** that
plan unlocks — the same pattern as Cursor. This implies a vendor-side subscription service for
plan auth and usage metering; that service never stores candidate data.
**Context:** Owner directive resolving PRD OQ-10. Target users are non-technical small-business
owners; asking them to obtain provider API keys is unacceptable UX.
**Alternatives:** Bring-your-own-key (rejected — UX burden, support burden, no monetisation of
model access); embedding a shared vendor key in the app (rejected — insecure, unmeterable).
**Rationale:** Clean UX and clean monetisation; the gateway abstraction (D-9) already isolates
providers, so subscription credentials slot in behind the same interface.
**Status:** Active. D-10 (index above); resolves OQ-10; the delivery architecture and plan tiers
were subsequently settled by D-12 and D-13.

### 2026-07-09 — Provider risk: disclose and disclaim, don't restrict
**Decision:** The boss may choose **any provider the app offers** (OpenAI, DeepSeek, Anthropic
Claude) regardless of jurisdiction or data policy. The app **flags the risk** at model selection
(candidate content transits the chosen provider) and the terms carry a **liability disclaimer**
so the vendor is not liable for the boss's provider choice. No provider exclusions.
**Context:** Owner directive resolving PRD OQ-11: target users are too small to warrant
per-jurisdiction provider gating.
**Alternatives:** Excluding providers by jurisdiction or gating sensitive data per provider
(rejected — disproportionate complexity for the user base; revisit only if a client demands it).
**Rationale:** Freedom of choice with informed consent; engineering ships the disclosure
mechanism, legal wording comes with the terms.
**Status:** Active. D-11 (index above); resolves OQ-11.

### 2026-07-09 — Model layer: cloud APIs behind a switchable provider gateway (minutes correction)
**Decision:** The AI layer uses **cloud model APIs behind a provider-abstraction gateway** built
from day one: adapters for OpenAI, DeepSeek, and Anthropic (Claude); the customer switches
provider/model in settings; every analysis records the provider + model that produced it. The
archived minutes' line "AI：本地模型优先，Hermes 魔改版本" was a **minute-taking error** by a
colleague summarising the client — the correct requirement: the *app and runtime* are locally
deployed and all *data* stays local, while the *model* is an API call.
**Context:** Owner correction on 2026-07-09 while resolving PRD OQ-1 (what "Hermes modified
build" meant). No local LLM ships with the product; the minutes file stays verbatim (minutes are
input, the PRD is truth — the correction lives here and in the PRD).
**Alternatives:** Local LLM runtime as minuted (void — transcription error); a single hard-coded
provider (rejected — the client explicitly wants switchability, and the previous product's
provider migration showed the cost of a hard-coded SDK).
**Rationale:** Provider abstraction from day one keeps feature code provider-free, enables
cost/quality trade-offs per provider, and removes the local-hardware constraint entirely.
**Status:** Active. D-9 (index above); resolves PRD OQ-1/OQ-3; amends D-2's model line; raised
OQ-10 (key provisioning → D-10) and OQ-11 (data-transit disclosure → D-11).

### 2026-07-09 — Client spec archived as meeting minutes; PRD restored as single source of truth
**Decision:** With `PRD.md` v2.x having absorbed the client technical spec in full, the spec moves
to `docs/meeting_minutes/2026-07-09-jobpin-technical-spec.md` (verbatim, dated). The temporary
hierarchy "spec > PRD" from the reset entry below is dissolved: **the PRD is again the single
source of truth**, and future client meetings produce new dated minutes under
`docs/meeting_minutes/` that are applied to the PRD by explicit update.
**Context:** Owner directive after the PRD rewrite. Keeping two competing authorities invites
drift; the spec's value is provenance, which the archive preserves (PRD citations like
*[spec 4.3]* point into the archived document).
**Alternatives:** Keep the spec at the repo root as standing upstream authority (rejected — every
future clarification would need edits in two places); delete it after absorption (rejected —
loses provenance and the PRD's citation targets).
**Rationale:** One living document to trust; a clean minutes-in → PRD-updated workflow for future
meetings. Conveniently, `CLAUDE.md` rule 1 ("PRD is the source of truth") is again literally true
with no amendment needed.
**Status:** Active. Recorded as D-8 (index above).

### 2026-07-09 — Product language: English-first
**Decision:** The product UI, templates, code, and repo documentation are English. Chinese remains
the client-meeting/minutes language only; key Chinese domain terms (老板, 魔改, 八字…) are kept
inline in the PRD where they aid traceability to the minutes.
**Context:** The client spec was written in Chinese, which raised the question of product
language; the owner clarified Chinese is just the development-meeting language.
**Alternatives:** Chinese-first or bilingual UI (rejected as unrequested scope; can be revisited
if the client asks).
**Rationale:** Matches the owner's direction and the AU business context of the product's
documents and emails.
**Status:** Active. Recorded as D-7 (index above); resolves PRD OQ-5.

### 2026-07-09 — Project reset: Jobpin replaces Shortlist; client spec becomes upstream authority
**Decision:** Remove the entire Shortlist implementation (Python/FastAPI backend, React web
frontend, synthetic data, era-specific plans/specs/handovers) and restart the project as
**Jobpin — a local-first, boss-only desktop hiring workbench** defined by
`JOBPIN_TECHNICAL_SPEC.md` (repo root). Document hierarchy from now on: **spec > `PRD.md` > code**;
on conflict the spec wins. `PRD.md` was rewritten (v2.0) from the spec; this log was cleared.
The full pre-reset state is preserved at git commit **`db5e511`**
("chore: snapshot Shortlist POC before Jobpin reset").
**Context:** An updated client meeting produced the Jobpin technical spec: Electron desktop app,
Node.js local server, SQLite + local files, a local LLM (Hermes modified build), optional Gmail,
single boss role, no cloud. The prior product (Australian small-business web POC on a cloud
OpenAI API with an identity-redaction pipeline) differs in stack, deployment, trust model, and
core mechanisms (e.g. the spec's flag-and-exclude sensitive-data handling vs redaction).
**Alternatives:** Incrementally refactor the Shortlist codebase toward Jobpin (rejected — nearly
nothing survives: different runtime, provider, data model, and product mechanics); keep the old
docs alongside (rejected — stale F-numbers and phase plans would actively mislead future
sessions; git history preserves them).
**Rationale:** A clean slate priced honestly beats a misleading continuity. Base infrastructure
kept: `CLAUDE.md` working agreement, this log (cleared), `docs/handover/` convention, `README.md`,
`.gitignore`. The OpenAI key file was preserved at the repo root (`.env`, gitignored) in case a
cloud fallback is ever approved (it is now useful for the D-9 gateway's dev credentials).
**Status:** Active. Initial engineering decisions taken with the reset are recorded as D-1…D-6 in
the index above. See `docs/handover/2026-07-09-jobpin-reset.md`.
