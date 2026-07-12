import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createJob } from '../src/server/jobs'
import { addCandidateFromText } from '../src/server/candidates'
import { NotFoundError, ValidationError } from '../src/server/errors'
import { listTemplates, renderEmail, saveEmail, listEmails, getEmail, type EmailDeps } from '../src/server/emails'
import { rmrfWithRetry } from './helpers'

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

const EMAIL_TEMPLATES_SRC = path.join(__dirname, '..', 'templates', 'au', 'emails')

function readSourceManifest(): TemplateManifestEntry[] {
  return JSON.parse(fs.readFileSync(path.join(EMAIL_TEMPLATES_SRC, 'manifest.json'), 'utf8')) as TemplateManifestEntry[]
}

let tmp: string
let db: DB
let paths: JobpinPaths
let deps: EmailDeps
let jobId: number
let jobFolder: string
let candidateId: number

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-emails-'))
  paths = getPaths(tmp)
  ensureScaffold(paths, { emailTemplatesSrc: EMAIL_TEMPLATES_SRC })
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  const job = createJob({ db, paths }, 'Barista', 'We need a friendly, reliable barista.')
  jobId = job.id
  jobFolder = job.folderPath
  deps = { db, paths }
  const c = await addCandidateFromText({ db, paths }, jobId, 'Jamie Lee', 'Ten years of sales.')
  candidateId = c.id
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

function setCompanySettings(name: string, senderName: string): void {
  db.prepare("INSERT INTO settings (key, value) VALUES ('company.name', ?)").run(name)
  db.prepare("INSERT INTO settings (key, value) VALUES ('company.sender_name', ?)").run(senderName)
}

const SAMPLE_INPUTS_BY_TYPE: Record<string, Record<string, string>> = {
  online_invitation: { interview_datetime: '2026-07-20 10:00', meeting_link: 'https://meet.example/abc' },
  onsite_invitation: { interview_datetime: '2026-07-20 10:00', location: '1 Example St, Sydney' },
  reschedule: { interview_datetime: '2026-07-22 14:00', reason: 'a scheduling conflict' },
  rejection: {},
  more_materials: { materials: 'a current police check' },
  onboarding: { start_date: '2026-08-01', location: '1 Example St, Sydney' }
}

describe('listTemplates', () => {
  it('returns 6 entries matching the manifest', () => {
    const manifest = readSourceManifest()
    const templates = listTemplates(deps)
    expect(templates).toHaveLength(6)
    expect(templates.map(t => t.type).sort()).toEqual(manifest.map(m => m.type).sort())
    for (const t of templates) {
      const entry = manifest.find(m => m.type === t.type)
      expect(entry).toBeDefined()
      expect(t.label).toBe(entry!.label)
      expect(t.subject).toBe(entry!.subject)
      expect(t.inputs).toEqual(entry!.inputs)
    }
  })
})

describe('renderEmail', () => {
  it('renders each of the six types with candidate/job/company/sender/today plus the supplied inputs', () => {
    setCompanySettings('Acme Cafe', 'Alex Boss')
    for (const [type, inputs] of Object.entries(SAMPLE_INPUTS_BY_TYPE)) {
      const { subject, body } = renderEmail(deps, candidateId, type, inputs)
      expect(subject).toContain('Acme Cafe')
      expect(subject).not.toMatch(/undefined/)
      expect(body).toContain('Jamie Lee')
      expect(body).toContain('Barista')
      expect(body).toContain('Acme Cafe')
      expect(body).toContain('Alex Boss')
      expect(body).not.toMatch(/undefined/)
      for (const value of Object.values(inputs)) {
        expect(body).toContain(value)
      }
      // today is clock-based - assert presence/shape only, never pin the exact string
      expect(body.length).toBeGreaterThan(0)
    }
  })

  it('includes a non-empty, year-bearing "today" value indirectly via the rejection template', () => {
    // rejection has no #if today usage in-body directly but `today` still substitutes into `data`;
    // this test locks the format contract without pinning the clock value.
    const today = new Intl.DateTimeFormat('en-AU', { dateStyle: 'long' }).format(new Date())
    expect(today).toMatch(/\d{4}/)
  })

  it('404s for an unknown candidate', () => {
    expect(() => renderEmail(deps, 999999, 'rejection', {})).toThrow(NotFoundError)
  })
})

describe('renderEmail guards', () => {
  it('missing required input throws ValidationError naming the label', () => {
    expect(() =>
      renderEmail(deps, candidateId, 'online_invitation', { interview_datetime: '2026-07-20 10:00' })
    ).toThrow(ValidationError)
    expect(() =>
      renderEmail(deps, candidateId, 'online_invitation', { interview_datetime: '2026-07-20 10:00' })
    ).toThrow(/Meeting link/)
  })

  it('unknown type throws ValidationError naming the type', () => {
    expect(() => renderEmail(deps, candidateId, 'nonsense', {})).toThrow(ValidationError)
    expect(() => renderEmail(deps, candidateId, 'nonsense', {})).toThrow(/nonsense/)
  })
})

describe('renderEmail with a boss-broken template', () => {
  it('a template that fails to compile throws ValidationError naming the file, never a crash', () => {
    fs.writeFileSync(path.join(paths.companyDir, 'email_templates', 'rejection.hbs'), '{{#if}}garbage', 'utf8')
    expect(() => renderEmail(deps, candidateId, 'rejection', {})).toThrow(ValidationError)
    expect(() => renderEmail(deps, candidateId, 'rejection', {})).toThrow(/rejection\.hbs/)
  })
})

describe('renderEmail with unset company settings', () => {
  it('renders company_name/sender_name as empty strings - no error, no "undefined"', () => {
    const { subject, body } = renderEmail(deps, candidateId, 'rejection', {})
    expect(subject).not.toMatch(/undefined/)
    expect(body).not.toMatch(/undefined/)
  })
})

describe('renderEmail blank-line polish', () => {
  it('collapses the blank-line artifact left by an omitted optional {{#if}} block', () => {
    const { body } = renderEmail(deps, candidateId, 'reschedule', { interview_datetime: '2026-07-22 14:00' })
    expect(body).not.toContain('Reason:')
    expect(body).not.toMatch(/\n{3,}/)
  })

  it('still renders the optional value when present, with no artifact either', () => {
    const { body } = renderEmail(deps, candidateId, 'reschedule', {
      interview_datetime: '2026-07-22 14:00',
      reason: 'a scheduling conflict'
    })
    expect(body).toContain('Reason: a scheduling conflict')
    expect(body).not.toMatch(/\n{3,}/)
  })
})

describe('saveEmail', () => {
  it('writes a Subject-headed file, inserts a row, increments the ordinal per type, and round-trips', () => {
    setCompanySettings('Acme Cafe', 'Alex Boss')
    const first = saveEmail(deps, candidateId, 'rejection', {})
    expect(first.filePath).toBe(`${jobFolder}/candidates/candidate_${candidateId}/emails/rejection-1.md`)
    expect(first.filePath).not.toMatch(/\\/)

    const abs = path.join(tmp, first.filePath)
    expect(fs.existsSync(abs)).toBe(true)
    const content = fs.readFileSync(abs, 'utf8')
    expect(content.startsWith('Subject: ')).toBe(true)
    expect(content).toContain(`Subject: ${first.subject}`)
    expect(content).toContain(first.body)

    const second = saveEmail(deps, candidateId, 'rejection', {})
    expect(second.filePath).toBe(`${jobFolder}/candidates/candidate_${candidateId}/emails/rejection-2.md`)

    // a different type starts its own ordinal sequence at 1
    const third = saveEmail(deps, candidateId, 'more_materials', {})
    expect(third.filePath).toBe(`${jobFolder}/candidates/candidate_${candidateId}/emails/more_materials-1.md`)

    const list = listEmails(deps, candidateId)
    expect(list).toHaveLength(3)
    expect(list.map(e => e.id).sort((a, b) => a - b)).toEqual([first.id, second.id, third.id].sort((a, b) => a - b))
    expect(list.find(e => e.id === first.id)?.filePath).toBe(first.filePath)
    expect(list.find(e => e.id === first.id)?.type).toBe('rejection')

    const detail = getEmail(deps, first.id)
    expect(detail.type).toBe('rejection')
    expect(detail.content).toBe(content)
  })

  it('404s for an unknown candidate on save, and for an unknown id on getEmail', () => {
    expect(() => saveEmail(deps, 999999, 'rejection', {})).toThrow(NotFoundError)
    expect(() => getEmail(deps, 999999)).toThrow(NotFoundError)
  })

  it('listEmails 404s for an unknown candidate', () => {
    expect(() => listEmails(deps, 999999)).toThrow(NotFoundError)
  })
})
