import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'

const here = path.dirname(fileURLToPath(import.meta.url))
const content = path.resolve(here, '../content')

/** First markdown H1 of a file, stripped of markdown emphasis. */
function titleOf(relFile: string): string {
  const abs = path.join(content, relFile)
  const text = fs.readFileSync(abs, 'utf8')
  const m = text.match(/^#\s+(.+)$/m)
  return (m ? m[1] : path.basename(relFile, '.md')).replace(/[*`]/g, '').trim()
}

/** Sidebar items for every .md in a content subdirectory. */
function itemsFor(relDir: string, opts: { first?: string } = {}) {
  const abs = path.join(content, relDir)
  if (!fs.existsSync(abs)) return []
  const files = fs.readdirSync(abs).filter(f => f.endsWith('.md'))
  files.sort((a, b) => (a === opts.first ? -1 : b === opts.first ? 1 : a.localeCompare(b)))
  return files.map(f => ({
    text: titleOf(`${relDir}/${f}`),
    link: `/${relDir}/${f.replace(/\.md$/, '')}`
  }))
}

export default defineConfig({
  title: 'Jobpin · Docs',
  description: 'Jobpin local-first hiring workbench - product docs, decisions, and engineering records',
  srcDir: 'content',
  cleanUrls: true,
  ignoreDeadLinks: true, // docs intentionally reference repo files that are not published
  themeConfig: {
    nav: [
      { text: 'PRD', link: '/PRD' },
      { text: 'Decisions', link: '/DECISIONS' }
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/Ruihang2017/HR-agent' }],
    outline: { level: [2, 3], label: 'On this page' },
    search: { provider: 'local' },
    sidebar: [
      {
        text: 'Product',
        items: [
          { text: 'PRD — source of truth', link: '/PRD' },
          { text: 'Glossary (CONTEXT)', link: '/CONTEXT' },
          { text: 'Decisions (index + log)', link: '/DECISIONS' }
        ]
      },
      {
        text: 'Design (HOW)',
        items: itemsFor('docs/design', { first: 'design-architecture.md' })
      },
      { text: 'Handovers', items: itemsFor('docs/handover', { first: 'README.md' }) },
      { text: 'Meeting minutes', items: itemsFor('docs/meeting_minutes') },
      {
        text: 'Engineering',
        items: [
          ...itemsFor('docs/superpowers/specs'),
          ...itemsFor('docs/superpowers/plans'),
          { text: 'Phase 0 install checklist', link: '/docs/phase0-install-checklist' }
        ]
      }
    ]
  }
})
