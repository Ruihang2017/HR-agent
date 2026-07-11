import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DB } from '../db'
import type { JobpinPaths } from '../paths'

/** One provenance manifest entry: what material fed the prompt, and how big it was. */
export interface ManifestEntry { kind: string; path: string; chars: number }

export interface PersistAiOutputArgs {
  jobId: number
  candidateId: number
  kind: string
  provider: string
  model: string
  promptVersion: string
  manifest: ManifestEntry[]
  confidence: number | null
  outputJson: string // pre-serialized payload
  candidateFolder: string // relative to dataRoot
  alsoLatestCopyAs?: string // e.g. 'ai_analysis.json' (candidate_analysis only)
}

export interface PersistAiOutputResult { analysisId: number; outputPath: string }

/**
 * Shared provenance persistence for every AI pipeline (Phase 2 candidate analysis,
 * Phase 3 interview pipelines): insert an `ai_analyses` row with a placeholder
 * output_path, write the versioned output file at
 * `<candidateFolder>/analyses/analysis_<id>.json`, optionally mirror it to a "latest"
 * filename in the candidate folder, then backfill `output_path` on the row.
 * If anything after the insert throws, the transaction rolls the row back and the
 * versioned file (if it was partially written) is removed - no orphaned analysis row
 * ever points at a missing file.
 */
export function persistAiOutput(
  deps: { db: DB; paths: JobpinPaths },
  args: PersistAiOutputArgs
): PersistAiOutputResult {
  const { db, paths } = deps
  const abs = (rel: string): string => join(paths.dataRoot, rel)

  let versionedRel = ''
  const insert = db.transaction((): number => {
    const info = db.prepare(
      `INSERT INTO ai_analyses (job_id, candidate_id, kind, provider, model, prompt_version, input_manifest, output_path, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)`
    ).run(
      args.jobId, args.candidateId, args.kind, args.provider, args.model,
      args.promptVersion, JSON.stringify(args.manifest), args.confidence
    )
    const id = Number(info.lastInsertRowid)
    versionedRel = `${args.candidateFolder}/analyses/analysis_${id}.json`
    mkdirSync(dirname(abs(versionedRel)), { recursive: true })
    writeFileSync(abs(versionedRel), args.outputJson)
    if (args.alsoLatestCopyAs) {
      writeFileSync(abs(`${args.candidateFolder}/${args.alsoLatestCopyAs}`), args.outputJson)
    }
    db.prepare('UPDATE ai_analyses SET output_path = ? WHERE id = ?').run(versionedRel, id)
    return id
  })

  try {
    const analysisId = insert()
    return { analysisId, outputPath: versionedRel }
  } catch (e) {
    if (versionedRel && existsSync(abs(versionedRel))) rmSync(abs(versionedRel), { force: true })
    throw e
  }
}
