import fs from 'node:fs'
import path from 'node:path'
import Handlebars from 'handlebars'
import type { DB } from './db'
import type { JobpinPaths } from './paths'
import { NotFoundError, ValidationError } from './errors'
import { candidateFolderFor } from './interviews'
import { writeCandidateFile, readCandidateFileText } from './candidate-fs'

export interface EmailDeps {
  db: DB
  paths: JobpinPaths
  dataKey?: Buffer
}

export interface TemplateInput {
  key: string
  label: string
  kind: string
  required: boolean
}

export interface TemplateInfo {
  type: string
  label: string
  subject: string
  inputs: TemplateInput[]
}

/** `manifest.json` shape (Task 1) - `file` is the boss-editable body, resolved internally only. */
interface ManifestEntry extends TemplateInfo {
  file: string
}

export interface EmailSummary {
  id: number
  type: string
  filePath: string
  createdAt: string
}

export interface EmailDetail {
  id: number
  type: string
  createdAt: string
  content: string
}

export interface CompanySettings {
  name: string
  senderName: string
}

function templatesDir(paths: JobpinPaths): string {
  return path.join(paths.companyDir, 'email_templates')
}

function readManifest(paths: JobpinPaths): ManifestEntry[] {
  const manifestPath = path.join(templatesDir(paths), 'manifest.json')
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestEntry[]
}

/** Boss-editable manifest, stripped to the public contract (no internal `file` name leaked). */
export function listTemplates(deps: EmailDeps): TemplateInfo[] {
  return readManifest(deps.paths).map(({ type, label, subject, inputs }) => ({ type, label, subject, inputs }))
}

function manifestEntryOrThrow(paths: JobpinPaths, type: string): ManifestEntry {
  const entry = readManifest(paths).find(e => e.type === type)
  if (!entry) throw new ValidationError(`unknown email template type "${type}"`)
  return entry
}

function settingValue(db: DB, key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? ''
}

function candidateAndJobOr404(db: DB, candidateId: number): { candidateName: string; jobName: string } {
  const row = db
    .prepare(
      `SELECT c.name AS candidateName, j.name AS jobName
       FROM candidates c JOIN jobs j ON j.id = c.job_id WHERE c.id = ?`
    )
    .get(candidateId) as { candidateName: string; jobName: string } | undefined
  if (!row) throw new NotFoundError(`candidate ${candidateId} not found`)
  return row
}

/**
 * Compiles and renders a Handlebars source string against `data`, never letting a boss's broken
 * edit crash the app: any compile OR render error becomes a ValidationError naming the file, with
 * no variable VALUES beyond Handlebars' own message text.
 */
function renderTemplate(file: string, source: string, data: Record<string, string>): string {
  try {
    const template = Handlebars.compile(source, { noEscape: true })
    return template(data)
  } catch (e) {
    throw new ValidationError(`template ${file} failed to render: ${(e as Error).message}`)
  }
}

/**
 * An omitted optional `{{#if x}}...{{/if}}` block that occupies its own line collapses to an
 * empty line, doubling up the blank line already surrounding it in the source copy. Trim
 * whitespace-only lines to empty and collapse 2+ consecutive blank lines to one - cosmetic only,
 * never touches lines with real content.
 */
function stripBlankLineArtifacts(body: string): string {
  return body
    .split('\n')
    .map(line => (line.trim() === '' ? '' : line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** Renders a template's subject + body for a candidate. Compiles per call (boss may have just edited the file). */
export function renderEmail(
  deps: EmailDeps,
  candidateId: number,
  type: string,
  inputs: Record<string, string>
): { subject: string; body: string } {
  const { db, paths } = deps
  const { candidateName, jobName } = candidateAndJobOr404(db, candidateId)
  const entry = manifestEntryOrThrow(paths, type)

  for (const input of entry.inputs) {
    if (input.required && !(inputs[input.key] ?? '').trim()) {
      throw new ValidationError(`missing required input: ${input.label}`)
    }
  }

  const data: Record<string, string> = {
    candidate_name: candidateName,
    job_name: jobName,
    company_name: settingValue(db, 'company.name'),
    sender_name: settingValue(db, 'company.sender_name'),
    today: new Intl.DateTimeFormat('en-AU', { dateStyle: 'long' }).format(new Date())
  }
  for (const input of entry.inputs) {
    data[input.key] = inputs[input.key] ?? ''
  }

  const bodySource = fs.readFileSync(path.join(templatesDir(paths), entry.file), 'utf8')
  const subject = renderTemplate(entry.file, entry.subject, data)
  const body = renderTemplate(entry.file, bodySource, data)
  return { subject, body: stripBlankLineArtifacts(body) }
}

/**
 * Renders and persists an email under the candidate's folder, then records it in `emails`.
 * File write happens first (through the candidate-fs seam - encrypted when a data key is
 * present), row insert second referencing the written path, mirroring the write-order
 * convention in candidates.ts's persistCandidate: on a post-write failure the partial file
 * is removed and the throw rolls back the transaction.
 */
export function saveEmail(
  deps: EmailDeps,
  candidateId: number,
  type: string,
  inputs: Record<string, string>
): { id: number; filePath: string; subject: string; body: string } {
  const { db, paths } = deps
  const { subject, body } = renderEmail(deps, candidateId, type, inputs)
  const candFolderRel = candidateFolderFor(db, candidateId)
  const emailsDirRel = `${candFolderRel}/emails`

  const id = db.transaction((): number => {
    const { c } = db
      .prepare('SELECT COUNT(*) AS c FROM emails WHERE candidate_id = ? AND type = ?')
      .get(candidateId, type) as { c: number }
    const n = c + 1
    const fileRel = `${emailsDirRel}/${type}-${n}.md`
    const fileAbs = path.join(paths.dataRoot, fileRel)
    try {
      writeCandidateFile(deps, fileRel, `Subject: ${subject}\n\n${body}`)
      const info = db
        .prepare('INSERT INTO emails (candidate_id, type, file_path) VALUES (?, ?, ?)')
        .run(candidateId, type, fileRel)
      return Number(info.lastInsertRowid)
    } catch (e) {
      fs.rmSync(fileAbs, { force: true }) // fs/db failed after the write → remove partial file; tx rolls back
      throw e
    }
  })()

  const row = db.prepare('SELECT file_path AS filePath FROM emails WHERE id = ?').get(id) as { filePath: string }
  return { id, filePath: row.filePath, subject, body }
}

export function listEmails(deps: EmailDeps, candidateId: number): EmailSummary[] {
  const { db } = deps
  candidateFolderFor(db, candidateId) // 404s if the candidate is unknown
  return db
    .prepare(
      'SELECT id, type, file_path AS filePath, created_at AS createdAt FROM emails WHERE candidate_id = ? ORDER BY created_at DESC, id DESC'
    )
    .all(candidateId) as EmailSummary[]
}

/** `company.name` / `company.sender_name` - the two settings keys `renderEmail` reads (above). */
export function getCompanySettings(deps: EmailDeps): CompanySettings {
  const { db } = deps
  return { name: settingValue(db, 'company.name'), senderName: settingValue(db, 'company.sender_name') }
}

/**
 * Partial update (each field optional/omittable): only keys present in `patch` are written,
 * so a boss setting just the name never clobbers an already-set sender name. Same upsert
 * pattern as `setAiSettings` (ai/settings.ts).
 */
export function setCompanySettings(deps: EmailDeps, patch: { name?: string; senderName?: string }): CompanySettings {
  const { db } = deps
  const put = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
  )
  db.transaction(() => {
    if (patch.name !== undefined) put.run('company.name', patch.name)
    if (patch.senderName !== undefined) put.run('company.sender_name', patch.senderName)
  })()
  return getCompanySettings(deps)
}

export function getEmail(deps: EmailDeps, emailId: number): EmailDetail {
  const { db } = deps
  const row = db
    .prepare('SELECT id, type, file_path AS filePath, created_at AS createdAt FROM emails WHERE id = ?')
    .get(emailId) as { id: number; type: string; filePath: string; createdAt: string } | undefined
  if (!row) throw new NotFoundError(`email ${emailId} not found`)
  const content = readCandidateFileText(deps, row.filePath)
  return { id: row.id, type: row.type, createdAt: row.createdAt, content }
}
