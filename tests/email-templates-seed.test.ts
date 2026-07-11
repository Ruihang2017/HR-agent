import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import Handlebars from 'handlebars'

interface TemplateInput {
  key: string
  label: string
  kind: string
  required: boolean
}

interface TemplateManifestEntry {
  type: string
  label: string
  file: string
  subject: string
  inputs: TemplateInput[]
}

const EMAILS_DIR = path.join(__dirname, '..', 'templates', 'au', 'emails')
const MANIFEST_PATH = path.join(EMAILS_DIR, 'manifest.json')

const EXPECTED_TYPES = [
  'online_invitation',
  'onsite_invitation',
  'reschedule',
  'rejection',
  'more_materials',
  'onboarding'
]

function readManifest(): TemplateManifestEntry[] {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as TemplateManifestEntry[]
}

describe('templates/au/emails manifest', () => {
  it('exists and parses as strict JSON', () => {
    expect(fs.existsSync(MANIFEST_PATH)).toBe(true)
    expect(() => readManifest()).not.toThrow()
  })

  it('declares exactly the six required email types, each with a unique type', () => {
    const manifest = readManifest()
    const types = manifest.map((m) => m.type)
    expect(new Set(types).size).toBe(types.length)
    expect([...types].sort()).toEqual([...EXPECTED_TYPES].sort())
  })

  it('every entry names a file that exists on disk', () => {
    for (const entry of readManifest()) {
      expect(typeof entry.file).toBe('string')
      expect(fs.existsSync(path.join(EMAILS_DIR, entry.file))).toBe(true)
    }
  })

  it('every subject and body compiles under Handlebars with no syntax errors', () => {
    for (const entry of readManifest()) {
      expect(() => Handlebars.compile(entry.subject, { noEscape: true })).not.toThrow()
      const body = fs.readFileSync(path.join(EMAILS_DIR, entry.file), 'utf8')
      expect(() => Handlebars.compile(body, { noEscape: true })).not.toThrow()
    }
  })

  it('every input has a non-empty string key and label, and correct required flags for the spec', () => {
    const expectedInputs: Record<string, Array<{ key: string; required: boolean }>> = {
      online_invitation: [
        { key: 'interview_datetime', required: true },
        { key: 'meeting_link', required: true }
      ],
      onsite_invitation: [
        { key: 'interview_datetime', required: true },
        { key: 'location', required: true }
      ],
      reschedule: [
        { key: 'interview_datetime', required: true },
        { key: 'reason', required: false }
      ],
      rejection: [],
      more_materials: [{ key: 'materials', required: false }],
      onboarding: [
        { key: 'start_date', required: true },
        { key: 'location', required: false }
      ]
    }

    for (const entry of readManifest()) {
      for (const input of entry.inputs) {
        expect(typeof input.key).toBe('string')
        expect(input.key.trim().length).toBeGreaterThan(0)
        expect(typeof input.label).toBe('string')
        expect(input.label.trim().length).toBeGreaterThan(0)
        expect(typeof input.required).toBe('boolean')
      }
      expect(entry.inputs.map((i) => ({ key: i.key, required: i.required }))).toEqual(
        expectedInputs[entry.type]
      )
    }
  })

  it('renders every template with sample data: greeting, sign-off, and inputs all present', () => {
    const sampleByType: Record<string, Record<string, string>> = {
      online_invitation: { interview_datetime: '2026-07-20 10:00', meeting_link: 'https://meet.example/abc' },
      onsite_invitation: { interview_datetime: '2026-07-20 10:00', location: '1 Example St, Sydney' },
      reschedule: { interview_datetime: '2026-07-22 14:00', reason: 'a scheduling conflict' },
      rejection: {},
      more_materials: { materials: 'a current police check' },
      onboarding: { start_date: '2026-08-01', location: '1 Example St, Sydney' }
    }

    for (const entry of readManifest()) {
      const body = fs.readFileSync(path.join(EMAILS_DIR, entry.file), 'utf8')
      const template = Handlebars.compile(body, { noEscape: true })
      const subjectTemplate = Handlebars.compile(entry.subject, { noEscape: true })
      const data: Record<string, string> = {
        candidate_name: 'Jamie Lee',
        job_name: 'Barista',
        company_name: 'Acme Cafe',
        sender_name: 'Alex Boss',
        today: '9 July 2026',
        ...sampleByType[entry.type]
      }

      const rendered = template(data)
      const subject = subjectTemplate(data)

      expect(rendered).toContain('Dear Jamie Lee,')
      expect(rendered).toContain('Kind regards,\nAlex Boss\nAcme Cafe')
      expect(subject).toContain('Acme Cafe')
      expect(rendered).not.toMatch(/undefined/)
      expect(subject).not.toMatch(/undefined/)

      for (const [key, value] of Object.entries(sampleByType[entry.type])) {
        if (value) expect(rendered).toContain(value)
        void key
      }
    }
  })

  it('optional-input conditionals omit cleanly when the input is absent', () => {
    const optionalCases: Array<{ type: string; file: string }> = [
      { type: 'reschedule', file: 'reschedule.hbs' },
      { type: 'more_materials', file: 'more_materials.hbs' },
      { type: 'onboarding', file: 'onboarding.hbs' }
    ]
    for (const { file } of optionalCases) {
      const body = fs.readFileSync(path.join(EMAILS_DIR, file), 'utf8')
      const template = Handlebars.compile(body, { noEscape: true })
      const rendered = template({
        candidate_name: 'Jamie Lee',
        job_name: 'Barista',
        company_name: 'Acme Cafe',
        sender_name: 'Alex Boss',
        today: '9 July 2026',
        start_date: '2026-08-01'
      })
      expect(rendered).not.toMatch(/undefined/)
      expect(rendered).not.toContain('Reason:')
      expect(rendered).not.toContain('Specifically:')
    }
  })
})
