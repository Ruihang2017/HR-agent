# CONTEXT — Glossary

> One canonical term per concept; rejected synonyms under _Avoid_. Definitions only —
> no specs, no rationale (that's `DECISIONS.md`), no requirements (that's `PRD.md`).

## Roles

**Boss (老板)**:
The single user and single role — the small-business owner-operator doing the hiring personally.
_Avoid_: user, admin, HR (there is no HR role; the product is boss-only by design)

## Product & documents

**Client minutes**:
The archived, verbatim record of a client meeting, under `docs/meeting_minutes/`. Input to the
PRD, never edited after archiving; corrections are recorded in `DECISIONS.md`.
_Avoid_: "the spec" (ambiguous — per-phase design documents are also called specs; say
"client minutes" or "design spec" explicitly)

**Design spec**:
A per-phase HOW document under `docs/superpowers/specs/` (the Focused zoom level): how one part
of the system is actually built.
_Avoid_: "the spec" without qualification

**Jobpin platform**:
The external product this tool deliberately does **not** integrate with — a permanent non-goal.
_Avoid_: treating "Jobpin" (this app) and "Jobpin platform" (the external product) as one thing

**D-n / F-n.m / Phase n**:
Stable identifiers: decisions (resolve in `DECISIONS.md`), functional requirements and phases
(live in `PRD.md`). Historical `OQ-n` open questions are all resolved; see the decision entries.

## AI & model access

**Model gateway**:
The single provider-abstraction layer for all AI calls — adapters for OpenAI / DeepSeek /
Anthropic (Claude); the only place provider SDKs appear.
_Avoid_: "LLM wrapper", provider-specific names in feature code

**Model catalog**:
The list of models the boss's subscription plan unlocks, selectable in settings. The boss never
handles API keys.

**Token issuance**:
The subscription-delivery pattern: the vendor service validates the plan and provisions scoped,
budget-capped provider credentials; the app calls model APIs directly, so candidate content never
transits the vendor.
_Avoid_: "vendor proxy" (the rejected alternative, where AI traffic routes through vendor servers)

**Flag-and-exclude**:
The sensitive-data mechanism: sensitive attributes found in input are marked "must not be used
for decisions" — never used in ranking, and never silently dropped either.
_Avoid_: redaction (the previous product's mechanism; deliberately not this one)

**Evidence source**:
The recorded origin of an AI conclusion (resume passage, interview answer, boss note). Every
candidate conclusion must carry one.

**Confidence (置信度)**:
The certainty level attached to every AI conclusion, alongside its evidence source.

## Data & memory

**`jobpin-data/`**:
The local root folder in the user's home directory holding all company/job/candidate material —
the substance; SQLite is the index. One folder = the complete data set.
_Avoid_: "app data" (suggests AppData; the folder is deliberately boss-visible)

**Company / job / candidate memory**:
The three isolated persistent-memory scopes. Company memory spans jobs; job memory
(`learned_skills.md`) is per-role; candidate memory (`profile.json`) is per-person.

**Learned skills (`learned_skills.md`)**:
Job memory: accumulated interview experience, written only via propose → approve → write.

**Memory event**:
A `memory_events` row recording a proposed or approved memory write, with scope and source.

**Inject (`inject.md`)**:
Job-specific context injected into AI calls for that job.

**Question bank (`question_bank.json`)**:
Per-job store of interview questions feeding generation; kept free of unlawful questions.

**Ranking snapshot**:
The immutable persisted record of one ranking run — criteria plus per-candidate
rank/score/reason. Never edited or deleted by the application.
_Avoid_: "ranking history" as a mutable log — snapshots are append-only facts

## Deferred / peripheral

**STT / TTS**:
Speech-to-text (voice interview capture) / text-to-speech (question read-out) — post-MVP.

**Zodiac / bazi / MBTI (星座/八字/MBTI)**:
Explicitly non-decisional labels: allowed only as boss-entered side notes marked "not a decision
basis"; never inputs to analysis or ranking.
