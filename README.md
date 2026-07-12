# Jobpin — Local-First Hiring Workbench

A boss-only hiring assistant that runs on the boss's own computer: Electron desktop app,
embedded local server, SQLite + local files. The AI analyses and ranks candidates with evidence
and confidence; the boss makes every decision. Full definition, scope, and status: **[`PRD.md`](PRD.md)**
(the source of truth — see its header for current project status).

## Directory structure

```
PRD.md                     product spec (WHAT) — read this first; status in its header
CONTEXT.md                 glossary — one canonical term per concept
DECISIONS.md               decision index (D-1…) + dated log (WHY)
CLAUDE.md                  working agreement for contributors, human or AI (process rules)
src/                       the app: main / preload / renderer (routed UI) / server (jobs, candidates, extraction, ai/ gateway+queue+analysis, ranking)
tests/                     Vitest suite (run via `npm test` only — see Run it)
templates/                 developer-supplied, lawyer-reviewed AU template content
docs/
  design/                  technical design layer (HOW overview): architecture · data & memory · workflows
  handover/                one handover per phase / major unit of work
  meeting_minutes/         archived client meeting outcomes (verbatim, superseded by PRD)
  superpowers/specs/       per-phase design docs (HOW)
  superpowers/plans/       per-phase implementation plans
  phase0-install-checklist.md   packaged-build verification
  reference/               external reference material (e.g. the doc-system spec)
site/                      docs portal (VitePress) — auto-deploys to Netlify on push to main
```

## Document map (which doc, when)

| Doc | What it is | When to read |
|---|---|---|
| [`PRD.md`](PRD.md) | Product spec — the source of truth | **First**, and before any product change |
| [`CONTEXT.md`](CONTEXT.md) | Glossary | Any time a term is unclear |
| [`DECISIONS.md`](DECISIONS.md) | Decision registry: index D-1… + dated entries | "Why is it this way?" |
| [`docs/design/`](docs/design/) | Technical design overview (HOW): architecture, data & memory, workflows | Reviewing the approach; orienting before any build |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | Per-phase design specs (detailed HOW) | Building or reviewing a specific part |
| [`docs/handover/`](docs/handover/) | Phase handovers | Picking up work mid-stream |
| [`docs/meeting_minutes/`](docs/meeting_minutes/) | Client input, archived verbatim | Tracing a requirement to its origin |
| [`CLAUDE.md`](CLAUDE.md) | Process rules / working agreement | Before contributing |

## Reading paths by role

- **Product / client:** `PRD.md` → the docs portal (same content, searchable, with a feedback form)
- **Technical reviewer:** `PRD.md` → `docs/design/` (architecture → memory → workflows) → `DECISIONS.md` for any "why"
- **Engineering:** `PRD.md` sections 8–11 → `docs/design/` → the relevant phase spec in `docs/superpowers/specs/` → `DECISIONS.md`
- **AI collaborator (new session):** `CLAUDE.md` → `PRD.md` → `CONTEXT.md` → latest handover in `docs/handover/`

**Decision registry:** the index table at the top of [`DECISIONS.md`](DECISIONS.md).
**Open questions:** none open — every question raised to date is resolved into a decision (resolution notes live in the `DECISIONS.md` entries).

## Run it

Prereqs: Node 22+ (see `.nvmrc`), npm. Windows is the supported dev/ship OS (D-14).

    npm install        # postinstall rebuilds better-sqlite3 for Electron's ABI
    npm run dev        # launch the app (dev mode, HMR)
    npm test           # unit tests (runs Vitest under Electron's node - do NOT use npx vitest)
    npm run typecheck
    npm run dist       # build the Windows NSIS installer into dist/

First launch creates `%USERPROFILE%\jobpin-data\` (your data, all local) and
`jobpin.db` inside it with the full schema. Packaged-build verification:
`docs/phase0-install-checklist.md`.

Note: on Node 22.11 the `dist` script needs the bundled
`NODE_OPTIONS=--experimental-require-module` (already in the script);
upgrading to Node ≥ 22.12 makes it unnecessary.

### AI features (Phases 2-3)

Analysis and ranking call a boss-chosen provider directly from this computer — no vendor
service sits in between yet (that's a later phase; see `DECISIONS.md`). To enable it, add
whichever of these keys you have to a local `.env` (repo root, gitignored, never committed):

    OPENAI_API_KEY=...
    DEEPSEEK_API_KEY=...
    ANTHROPIC_API_KEY=...

Pick the active provider and model on the **Settings** page — it shows the plan, a
jurisdiction/data-handling disclosure per provider (confirm before switching), and an
advisory usage bar (used / allowance; the numbers are dev-stub placeholders, see D-13).

Each candidate can run one or more interview rounds. The AI drafts a question set across
five categories (standard, resume-specific, JD-risk, boss-favourite, follow-up), filtering
out anything that touches an unlawful or protected-attribute topic before it reaches the
boss — with a visible count of how many were dropped. Every recorded answer can get a short
per-item AI take, and closing out a round produces a written summary: an
interview-performance ranking factor built from whichever items the boss flagged, plus
memory proposals the boss approves or rejects one at a time. Approved lessons are appended
to the job's `learned_skills.md`; any proposal that mentions a protected attribute is
refused automatically, before the boss ever sees it. Good questions can also be starred
straight into the job's `question_bank.json` for reuse in later rounds.

Offline / no-key behaviour: everything except analysis and the three interview AI actions
— question generation, per-answer takes, and round summaries — keeps working with no key
configured or no network — jobs, candidates, extraction, ranking of already-analysed
candidates, settings. Only those four actions fail, visibly, with a plain auth/network
message.

**Cross-provider eval** (dev-only, run manually — never from tests or CI):

    node scripts/ai-eval.mjs          # dry run: prints the call plan, makes no calls
    node scripts/ai-eval.mjs --yes    # runs 5 synthetic resumes through every provider with a key

It calls each configured provider with the same request shapes as the real adapters,
validates the JSON shape, prints a provider × resume factor-score matrix, and flags any
sensitive-vs-scrubbed factor delta greater than 10 points. Each `--yes` run is real,
billed API traffic — the script prints the exact call count up front and requires `--yes`
to proceed. Results are written to `docs/superpowers/evals/<date>-phase-2-eval.md`.

### Emails (Phase 4)

Each candidate's page can generate offer/rejection/interview-invite email templates from the
company identity set on **Settings** — preview or copy the rendered subject/body to your own
clipboard. Jobpin never sends anything itself; it only drafts text you paste into your own
mail client.

### Data protection (Phase 5)

Candidate data is encrypted at rest by default (D-17): a random per-install AES-256 key is
wrapped via your Windows account (`safeStorage`/DPAPI) and stored at
`jobpin-data\.keys\master.key` — nothing to type, nothing to remember. If your OS keychain is
ever unavailable, the app keeps working unencrypted and the Settings **Data protection** card
shows a persistent warning rather than failing silently. Company/job files (JD, notes,
`learned_skills.md`) stay plain text by design — only candidate trees and candidate-bearing DB
content are encrypted.

**Backup & restore** (Settings → Data protection): "Back up…" writes the whole data set as one
portable file, either passphrase-encrypted (`.jpbak`, recommended) or a plain zip behind an
explicit "I understand candidate data will be unprotected" acknowledgement. **There is no
passphrase recovery — losing it makes that backup permanently unreadable; write it down
somewhere safe.** "Restore…" picks a backup file, asks for its passphrase if encrypted, and
requires typing "restore" to confirm. Jobpin then stages the restore and **closes** — reopen it
and the restored data is applied on that launch (Jobpin does not relaunch itself: on managed
Windows machines a second process starting while the first is still closing would collide over
the data folder). The pre-restore data is kept alongside it as a dated
`jobpin-data.pre-restore-<timestamp>` folder for you to delete manually once you've confirmed the
restore worked.

**Deletion** (Delete button on Job and Candidate pages, typed-name confirmation required):
deleting a **candidate** anonymises them — name/email/phone are scrubbed and their files
removed, but every past ranking snapshot keeps that candidate's rank and score with the name
replaced, so historical rankings never silently reshuffle. Deleting a **job** is a full cascade:
the job, every one of its candidates, and its entire ranking history are removed outright,
along with its folder on disk. Both actions call `DELETE /candidates/:id` / `DELETE /jobs/:id`
and cannot be undone from the UI.
