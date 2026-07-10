# Documentation System Spec

> A portable, domain-neutral specification of a project documentation system.
> It captures **structure + conventions + disciplines** — not any one project's content.
> Hand it to a project, keep your own domain context, and rebuild your docs to this shape.

---

## 0. How to use this document

This spec describes a documentation system that separates a project's knowledge **by concern** — what it does, how it's built, why key decisions were made, what the terms mean — so each piece of knowledge lives in exactly one place and is easy to find, update, and keep honest.

Apply it like this:

1. Read **§1 Core principle** and **§2 File set** to understand the shape.
2. Use **§6 Skeletons** to create each file for your own project, filling in your own content.
3. Follow **§7 Adoption recipe** if you're splitting an existing single-document project.
4. Keep **§8 Anti-patterns** open while you work — most failures are listed there.
5. Right-size with **§9** — do not adopt parts your project doesn't need yet.

Nothing here is domain-specific. Wherever you see `<Placeholder>`, substitute your own.

---

## 1. Core principle

> **One concern, one source of truth. Everything else points to it — never copies it.**

Knowledge in a project falls into a few distinct kinds. Each kind has different readers and changes at a different rate. Mixing kinds in one file couples their lifecycles: a volatile part forces churn on a stable part, and duplicated facts drift apart. So we split **by kind of concern**, not by file size:

| Concern | Question it answers | Home | Changes… |
|---|---|---|---|
| **WHAT** | What are we building, for whom, in what scope? | `PRD.md` | slowly (stable) |
| **HOW** | How is it built, at three zoom levels? | `docs/design-*.md` | often (volatile) |
| **WHY** | Why was this hard, irreversible decision made? | `docs/adr/` | never (immutable; supersede) |
| **TERMS** | What does this word mean, canonically? | `CONTEXT.md` | rarely |
| **RED LINES** | What invariants must never be violated? | `CLAUDE.md` | rarely |
| **NAV** | Where do I find things / where do I put things? | `README.md` | as docs grow |
| **PROVENANCE** | What was the original raw input? | `ORIGINAL_TECHNICAL_NOTES.md` | frozen |

The payoff: you can rewrite the entire HOW layer without touching the WHAT layer; you can lock the WHY layer while the HOW churns; and a term is defined once, so it can't mean two things.

---

## 2. The file set

Each file has a **single responsibility**. If you're tempted to put content in two files, you've mis-drawn a boundary.

| File | Single responsibility |
|---|---|
| `README.md` | **Navigation hub.** Directory tree · document map (which doc, when to read it) · reading paths by role · decision registry (index of ADRs) · open-questions register. The entry point. |
| `CLAUDE.md` | **AI-collaborator guide + red lines.** Product positioning · locked decisions · **numbered cross-cutting invariants** · pointers to terms/conventions. The rules an AI (or human) must hold while working. |
| `CONTEXT.md` | **Glossary, and nothing else.** One canonical word per concept; rejected synonyms listed under `_Avoid_`. Not a spec, scratchpad, or decision log. |
| `docs/PRD.md` | **Product spec (WHAT).** Background → positioning → users → scope (in/out) → workflows → data → constraints/compliance → cost → roadmap → risks. **Points down** to design docs instead of embedding their detail. |
| `docs/design-<overview>.md` | **Component/responsibility overview (HOW — wide).** Every component: description · capabilities · tools · **scope (owns ✅ / explicitly does-not ❌)** · guardrails · cost tier. |
| `docs/design-<runbook>.md` | **State-by-state runbook (HOW — deep).** The same state machines zoomed to each state, as a uniform table. |
| `docs/design-<subsystem>.md` | **Single-subsystem deep-dive (HOW — focused).** One complex subsystem taken to the bottom. Add one per subsystem that outgrows a PRD subsection. |
| `docs/adr/NNNN-slug.md` | **Architecture Decision Record (WHY).** One decision that is hard-to-reverse, surprising, and a real trade-off. Immutable; append-only. |
| `ORIGINAL_TECHNICAL_NOTES.md` | **Original-input archive.** The raw first input (client spec, founder's notes), preserved verbatim for provenance. Header explicitly states "superseded by the PRD; not the current source of truth." |

> Naming: the three `design-*` files are named by their **content**, e.g. `design-<subsystem>.md`. Use whatever nouns fit your project. What matters is the three *zoom levels* below, not the filenames.

---

## 3. The layering model of HOW — three zoom levels

The single most reusable idea here: **describe the same system at three magnifications**, each in its own file, each with a fixed internal structure.

| Zoom | File role | Answers | Internal structure |
|---|---|---|---|
| **Wide** | component overview | "What components exist, what each owns, and what each explicitly does NOT do." | Per component, the **same set of sub-sections**: description · capabilities · tools · scope (✅ owns / ❌ does-not) · guardrails · cost/effort tier. |
| **Deep** | state runbook | "For each state: what enters it, what happens, what gets written, what can block it, where it goes next." | Per flow, the **same table**: `State │ Entry event │ Actions │ Writes │ Guardrails │ Transitions`, plus a Failure/Blocked row. |
| **Focused** | subsystem deep-dive | "How does this one complex subsystem actually work, end to end." | Positioning → goals/constraints → taxonomy → per-item detail → storage mapping → read/write paths → isolation → lifecycle → anti-patterns → open questions. |

Not every project needs all three. A small project may need only **Focused** (one deep-dive on its hardest subsystem). Add **Deep** when you have real state machines. Add **Wide** when you have several components whose boundaries blur.

---

## 4. Cross-referencing model

Documents form a graph, wired by explicit links so a reader always knows where the authoritative version lives.

```
README ───indexes──▶ everything (doc map + ADR registry + open questions)

PRD ──"see design-X for how"──▶ design-* docs
                                    │
design-* ──"defined by"──▶ ADR (the decision that fixed this shape)
design-* ──"see CONTEXT"──▶ CONTEXT.md (for any domain term)
design-* ──"see red line #N"──▶ CLAUDE.md (for invariants)

ADR ◀──registered in── README decision table
ORIGINAL_NOTES ──"superseded by"──▶ PRD
```

Rules for links:

- **Every design doc opens with a companion line**: `> Companion: PRD §N · <other design docs> · CONTEXT | version vX · date`.
- **The PRD references design docs by section** (`§N → design-<x>`) rather than restating their content.
- **Design docs reference the ADR that fixed their shape** (`> Rationale: see ADR-NNNN`).
- **The README registers every ADR** in a decision table, so "why is it this way?" has a single lookup.

---

## 5. The disciplines (the part that actually matters)

Anyone can create the folders. These conventions are what make the system stay coherent as it grows. **Violating them is what makes docs rot.**

1. **One concern, one source of truth.** Terms only in CONTEXT; red lines only in CLAUDE; why only in ADRs; what only in PRD. Elsewhere, **point — do not copy.**
2. **Point, don't duplicate.** If the same fact appears in two files and they diverge, which is true? Kill duplication with links. A restated fact is a future contradiction.
3. **Each doc declares its zoom level and defers shared rules.** State it in the header: *"General rules (execution model / node contracts / invariants) live in `<X>` and are not repeated here."* This stops rules from being copied three times and then edited in only one.
4. **Versioned headers.** Every design doc carries `version vX · date`. The PRD and ADRs carry a status field. A reader can tell staleness at a glance.
5. **ADRs are four-part and immutable.** Each ADR = `Status` + **Decision** + **Why** + **Considered & rejected (with reasons)** + **Consequences**. To change your mind, write a *new* ADR and mark the old one `Superseded by ADR-NNNN`. Never edit a decided ADR's substance. Only decisions that are **hard-to-reverse + surprising + a real trade-off** deserve an ADR; the rest don't.
6. **The glossary is only a glossary.** One or two sentences per term. One canonical word per concept; list rejected synonyms under `_Avoid_`. No specs, no scratch notes, no decision history. Pick the canonical term and enforce it everywhere else.
7. **Red lines are numbered invariants.** CLAUDE.md holds cross-cutting constraints as a **numbered list**, each stated as "violating this is a bug, not a style choice," so they can be cited precisely elsewhere (`see red line #4`).
8. **Repeated sub-structure = predictability.** Same kind of thing → identical template (every component uses the same sub-sections; every flow uses the same table columns). The reader learns the shape once and reads the whole file fast.
9. **State contracts once, reference everywhere.** Recurring rules (e.g. "every node returns typed output + confidence + rationale, passes schema, and on failure retries then parks to a human") are defined in one place and referenced — never re-explained per instance.
10. **Register open questions; don't hide them.** README and each design doc end with an "Open questions" list — non-blocking but on the record. Admitting "not yet decided" beats pretending it's settled.

---

## 6. Skeletons (copy these, fill with your own content)

### 6.1 `CONTEXT.md` — glossary entry

```markdown
## <Category, e.g. Roles / Entities / Lifecycle>

**<CanonicalTerm>**:
<One or two sentences defining the term. What it is, what it anchors,
what distinguishes it from the near-miss term next to it.>
_Avoid_: <RejectedSynonym1>, <RejectedSynonym2> (say why one is wrong if subtle)
```

### 6.2 `docs/adr/NNNN-slug.md` — decision record

```markdown
# NNNN — <Short imperative title of the decision>

Status: proposed | accepted | superseded by ADR-MMMM

## Decision
<What we decided, stated flatly. The rule now in force.>

## Why
<The context and forces. Why this was the right call given the constraints.>

## Considered and rejected
- **<Alternative>**: <why it was rejected — the trade-off that lost.>

## Consequences
- <What this makes easy, what it makes hard, what now must hold.>
```

### 6.3 Design doc header (all three zoom levels share this)

```markdown
# Design — <Subsystem / Component set / Workflows>

> Companion: PRD §N · <sibling design docs> · CONTEXT | version v0.1 · <date>
> Rationale fixed by ADR-NNNN. General rules (<execution model / contracts /
> invariants>) live in <X> and are not repeated here.
```

### 6.4 Component overview entry (Wide zoom)

```markdown
## <Component name>

**Description**: <what it drives, in one or two sentences.>

**Capabilities**: <the "fuzzy"/LLM or logic nodes — what each does.>

**Tools**: <the deterministic tools/services it calls.>

**Scope**
- ✅ <what it owns>
- ❌ <what it explicitly does NOT do — and who does instead>

**Guardrails (human)**: <where a human gate is mandatory.>

**Cost/effort tier**: <cheap / upgraded / deterministic, etc.>
```

### 6.5 State runbook table (Deep zoom)

```markdown
## <Workflow name> (one instance per <Entity>)

**Entry**: <what starts an instance>
**Timers**: <scheduled events that advance or expire it>

| State | Entry (event) | Actions (node · tool) | Writes | Guardrails | Transitions |
|---|---|---|---|---|---|
| <state> | <event> | <what happens> | <what persists> | <human gate?> | <next states, incl. branch> |

**Failure / Blocked**: <how bad input, low confidence, or timeouts route to a
durable Blocked/Needs-human state.>
```

### 6.6 `README.md` — the navigation sections

```markdown
## Directory structure
<tree with one-line purpose per file>

## Document map (which doc, when)
| Doc | What it is | When to read |
|---|---|---|
| PRD | product spec | **read this first** |
| design-* | how, at three zoom levels | building a specific part |
| CONTEXT | glossary | any time a term is unclear |
| CLAUDE | positioning + red lines | before writing code |
| adr/ | why decisions were made | "why is it this way?" |

## Reading paths by role
- Product/business: README → PRD
- Engineering: PRD §<design sections> → design-* → adr/
- AI collaborator: CLAUDE → CONTEXT

## Decision registry
| Decision | Basis |
|---|---|
| <decision> | ADR-NNNN / constraint / red line #N |

## Open questions (non-blocking, on record)
- <question> — <where it's tracked>
```

### 6.7 `CLAUDE.md` — invariants block

```markdown
## Cross-cutting invariants (any implementation MUST hold these)

Violating one is a bug, not a style choice:

1. **<Invariant name>.** <The rule, stated absolutely, with the reason it exists.>
2. **<Invariant name>.** <…>
```

### 6.8 `ORIGINAL_TECHNICAL_NOTES.md` — header

```markdown
# Original technical notes (superseded by the PRD)

> These are the earliest raw notes, kept for provenance/traceability only.
> They are NOT the current source of truth — see `docs/PRD.md`.
> Items here about <X, Y, Z> may have been rescoped or rewritten by the PRD.
```

---

## 7. Adoption recipe (from a single big document)

Do this in order — it front-loads the cheap, high-leverage moves and defers the splits until you know where the seams are.

1. **Extract the glossary → `CONTEXT.md`.** Cheapest, highest leverage, depends on nothing. Pin every load-bearing term to one canonical word.
2. **Promote real decisions → `docs/adr/`.** Take the entries in your decision log that are *hard-to-reverse + surprising + a real trade-off* and rewrite them as four-part ADRs. Leave the trivial ones in the log.
3. **Slim the PRD to WHAT.** Keep background, positioning, users, scope, workflow overview, data outline, constraints, roadmap, risks. Mark the embedded HOW (detailed data models, per-phase technical approaches) for extraction.
4. **Extract the hardest subsystem → a Focused design doc.** Usually the one whose design most overflows its PRD subsection. Have the PRD section now **point** to it. Add the Deep (runbook) and Wide (overview) docs only if/when you actually have state machines or multiple blurry-boundaried components.
5. **Rewrite `README.md`** with the doc map, reading paths, decision registry, and open-questions register.
6. **Write `CLAUDE.md`**: positioning + numbered red lines + pointers to CONTEXT/conventions.
7. **Freeze the original input** as `ORIGINAL_TECHNICAL_NOTES.md` with the "superseded" header.

---

## 8. Anti-patterns (open this while working)

- **Design embedded in a locked requirements doc.** If the PRD holds volatile design *and* is policy-locked, the design either forces constant PRD edits or silently goes stale and becomes fiction. Move volatile HOW into design docs.
- **The same fact in two files.** Guaranteed future contradiction. Point, don't copy.
- **The PRD drifting from its own design docs.** Even a well-structured system rots if links aren't maintained — the PRD says one thing, the design docs another. Treat the PRD→design references as something you *verify*, not just write once. (This is the most common real-world failure; check for it periodically.)
- **Glossary creep.** The moment CONTEXT.md gains specs, rationale, or TODOs, it stops being a trustworthy term source. Keep it to definitions.
- **ADR inflation.** Writing an ADR for every small choice buries the few that matter. Reserve ADRs for the hard-to-reverse, surprising, real-trade-off decisions.
- **Editing a decided ADR's substance.** Destroys the decision history. Supersede with a new ADR instead.
- **Rules copied into every doc.** Shared contracts drift when edited in only one copy. State once, reference everywhere.
- **Splitting too early.** Before you feel the pain, the seams you guess will be wrong. A thorough single document is the correct starting point; split when it hurts (§9).

---

## 9. Right-sizing — don't over-apply

This system scales *down*. Adopt only what your project's size and stage justify:

- **Solo project / early stage / stable design** → a thorough single PRD may be exactly right. The value of `CONTEXT.md` and `docs/adr/` still applies (cheap, high-leverage), but you may not need three design docs yet.
- **The trigger to split** is pain, not aspiration: you keep re-editing the same design section because reality diverged, *or* a subsystem's design overflows its PRD subsection, *or* more than one person needs to edit the same file at once. Split **that one thing** then — not everything at once.
- **When you do adopt it, keep a note of which files earned their place and which were added just to look complete.** That list is often more valuable than the reorganization itself.

---

## 10. One-line summary

> **Separate knowledge by concern (what / how / why / terms / red lines), give each concern exactly one home, wire the homes together with links instead of copies, and split the "how" into as many zoom levels as your project's pain actually requires — no more.**
