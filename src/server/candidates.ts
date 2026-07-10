import fs from 'node:fs'
import path from 'node:path'
import type { JobsDeps } from './jobs'
import { extractText, extOf, type ExtractResult } from './extract'
import { NotFoundError, ValidationError } from './errors'

export interface CandidateSummary {
  id: number
  name: string
  status: string
  createdAt: string
}

export interface CandidateDetail extends CandidateSummary {
  jobId: number
  email: string | null
  phone: string | null
  extractedText: string | null
  extraction: { status: 'ok' | 'failed'; error?: string }
  originalFilename?: string
  folderPath: string
}

interface Profile {
  name: string
  email: string | null
  phone: string | null
  source: 'upload' | 'paste'
  originalFilename?: string
  extraction: { status: 'ok' | 'failed'; error?: string }
  createdAt: string
}

function jobFolderOr404(deps: JobsDeps, jobId: number): string {
  const row = deps.db.prepare('SELECT folder_path FROM jobs WHERE id = ?').get(jobId) as
    | { folder_path: string }
    | undefined
  if (!row) throw new NotFoundError(`job ${jobId} not found`)
  return row.folder_path
}

/** Shared write path for both intake modes. `originalName` = stored original file name. */
function persistCandidate(
  deps: JobsDeps,
  jobId: number,
  jobFolderRel: string,
  name: string,
  originalName: string,
  originalBytes: Uint8Array,
  result: ExtractResult,
  profileBase: Pick<Profile, 'source' | 'originalFilename'>
): number {
  const { db, paths } = deps
  const status = 'text' in result ? 'new' : 'needs_review'

  const insert = db.transaction(() => {
    const info = db.prepare('INSERT INTO candidates (job_id, name, status) VALUES (?, ?, ?)').run(jobId, name, status)
    const id = Number(info.lastInsertRowid)
    const candRel = `${jobFolderRel}/candidates/candidate_${id}`
    const candAbs = path.join(paths.dataRoot, candRel)
    try {
      fs.mkdirSync(candAbs, { recursive: true })
      fs.writeFileSync(path.join(candAbs, originalName), originalBytes)
      let extractedRel: string | null = null
      if ('text' in result) {
        extractedRel = `${candRel}/resume_text.md`
        fs.writeFileSync(path.join(candAbs, 'resume_text.md'), result.text, 'utf8')
      }
      const profile: Profile = {
        name,
        email: null,
        phone: null,
        ...profileBase,
        extraction: 'text' in result ? { status: 'ok' } : { status: 'failed', error: result.error },
        createdAt: new Date().toISOString()
      }
      fs.writeFileSync(path.join(candAbs, 'profile.json'), JSON.stringify(profile, null, 2) + '\n', 'utf8')
      db.prepare(
        'INSERT INTO candidate_documents (candidate_id, type, file_path, extracted_text_path) VALUES (?, ?, ?, ?)'
      ).run(id, 'resume', `${candRel}/${originalName}`, extractedRel)
      return id
    } catch (e) {
      fs.rmSync(candAbs, { recursive: true, force: true }) // fs failed → remove partial folder; tx rolls back
      throw e
    }
  })
  return insert()
}

export async function addCandidateFromFile(
  deps: JobsDeps,
  jobId: number,
  originalFilename: string,
  bytes: Uint8Array,
  name?: string
): Promise<CandidateDetail> {
  const jobFolderRel = jobFolderOr404(deps, jobId)
  const ext = extOf(originalFilename)
  const stem = originalFilename.replace(/\.[^.]*$/, '')
  const candidateName = (name ?? '').trim() || stem.trim() || 'Unnamed candidate'
  const result = await extractText(bytes, ext)
  const storedName = `resume.${ext || 'bin'}` // contract-stable original filename (spec section 4)
  const id = persistCandidate(deps, jobId, jobFolderRel, candidateName, storedName, bytes, result, {
    source: 'upload',
    originalFilename
  })
  return getCandidate(deps, id)
}

export async function addCandidateFromText(
  deps: JobsDeps,
  jobId: number,
  name: string,
  text: string
): Promise<CandidateDetail> {
  const jobFolderRel = jobFolderOr404(deps, jobId)
  const candidateName = (name ?? '').trim()
  if (!candidateName) throw new ValidationError('candidate name is required for pasted resumes')
  if (!(text ?? '').trim()) throw new ValidationError('resume text is required')
  const id = persistCandidate(
    deps, jobId, jobFolderRel, candidateName, 'resume.md',
    new TextEncoder().encode(text), { text }, { source: 'paste' }
  )
  return getCandidate(deps, id)
}

export function listCandidates(deps: JobsDeps, jobId: number): CandidateSummary[] {
  jobFolderOr404(deps, jobId)
  return deps.db
    .prepare(
      'SELECT id, name, status, created_at AS createdAt FROM candidates WHERE job_id = ? ORDER BY created_at DESC, id DESC'
    )
    .all(jobId) as CandidateSummary[]
}

export function getCandidate(deps: JobsDeps, id: number): CandidateDetail {
  const { db, paths } = deps
  const row = db
    .prepare('SELECT id, job_id, name, email, phone, status, created_at FROM candidates WHERE id = ?')
    .get(id) as
    | { id: number; job_id: number; name: string; email: string | null; phone: string | null; status: string; created_at: string }
    | undefined
  if (!row) throw new NotFoundError(`candidate ${id} not found`)
  const doc = db
    .prepare("SELECT file_path, extracted_text_path FROM candidate_documents WHERE candidate_id = ? AND type = 'resume'")
    .get(id) as { file_path: string; extracted_text_path: string | null } | undefined

  const folderPath = doc ? doc.file_path.slice(0, doc.file_path.lastIndexOf('/')) : ''
  let extractedText: string | null = null
  if (doc?.extracted_text_path) {
    const abs = path.join(paths.dataRoot, doc.extracted_text_path)
    if (fs.existsSync(abs)) extractedText = fs.readFileSync(abs, 'utf8')
  }
  let extraction: CandidateDetail['extraction'] = { status: 'ok' }
  let originalFilename: string | undefined
  const profileAbs = path.join(paths.dataRoot, folderPath, 'profile.json')
  if (folderPath && fs.existsSync(profileAbs)) {
    try {
      const profile = JSON.parse(fs.readFileSync(profileAbs, 'utf8')) as Profile
      extraction = profile.extraction ?? extraction
      originalFilename = profile.originalFilename
    } catch {
      /* unreadable profile.json is non-fatal; defaults stand */
    }
  }
  return {
    id: row.id,
    jobId: row.job_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    createdAt: row.created_at,
    extractedText,
    extraction,
    originalFilename,
    folderPath
  }
}
