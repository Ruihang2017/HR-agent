// Allowlist copy of repo docs into site/content/ (paths preserved so relative
// links keep working). ONLY files listed/globbed here are ever published -
// nothing else in the repo can leak onto the site.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const out = path.join(here, 'content')

function globMd(relDir) {
  const abs = path.join(repo, relDir)
  if (!fs.existsSync(abs)) return []
  return fs
    .readdirSync(abs)
    .filter(f => f.endsWith('.md'))
    .map(f => `${relDir}/${f}`)
}

const ALLOW = [
  'PRD.md',
  'CONTEXT.md',
  'DECISIONS.md',
  'docs/phase0-install-checklist.md',
  ...globMd('docs/handover'),
  ...globMd('docs/meeting_minutes'),
  ...globMd('docs/superpowers/specs'),
  ...globMd('docs/superpowers/plans')
]

fs.rmSync(out, { recursive: true, force: true })
let copied = 0
for (const rel of ALLOW) {
  const src = path.join(repo, rel)
  if (!fs.existsSync(src)) continue
  const dst = path.join(out, rel)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  copied++
}

const home = `---
layout: home
hero:
  name: Jobpin
  text: Docs portal
  tagline: Local-first hiring workbench - product requirements, decisions, and engineering records
  actions:
    - theme: brand
      text: Read the PRD
      link: /PRD
    - theme: alt
      text: Decision log
      link: /DECISIONS
features:
  - title: PRD - source of truth
    details: Requirements, architecture, and the phased implementation plan.
    link: /PRD
  - title: Decisions
    details: The D-1... index plus dated entries with context and rationale.
    link: /DECISIONS
  - title: Handovers
    details: One handover per major implementation or phase.
    link: /docs/handover/README
  - title: Meeting minutes
    details: Client meeting outcomes, archived verbatim.
    link: /docs/meeting_minutes/2026-07-09-jobpin-technical-spec
---
`
fs.writeFileSync(path.join(out, 'index.md'), home, 'utf8')

// VitePress resolves the public dir relative to srcDir, so mirror site/public
// (the static Netlify form definition) into content/public.
const publicSrc = path.join(here, 'public')
const publicDst = path.join(out, 'public')
fs.mkdirSync(publicDst, { recursive: true })
for (const f of fs.readdirSync(publicSrc)) {
  fs.copyFileSync(path.join(publicSrc, f), path.join(publicDst, f))
}

console.log(`synced ${copied} docs into site/content/`)
