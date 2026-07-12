import fs from 'node:fs'
import path from 'node:path'
import type { DB } from './db'
import type { JobpinPaths } from './paths'
import { encryptBuffer, isEncrypted } from './cryptx'
import { renameSyncWithRetry } from './fsx'

/**
 * Sibling temp-file suffix for the encrypt-to-temp-then-rename dance below. Anything
 * with this suffix inside a candidate tree is a leftover from a crashed sweep, never a
 * real candidate file - the walker skips it, and the stale temp of a still-plaintext
 * source file is consumed (overwritten, then renamed away) when that file is re-swept
 * on the next run.
 */
const TMP_SUFFIX = '.jpenc-tmp'

export interface SweepDeps {
  db: DB
  paths: JobpinPaths
  dataKey: Buffer
}

export interface SweepResult {
  encrypted: number
  skipped: number
}

/**
 * First-boot candidate-file sweep (Task 8), Electron-free and fully unit-testable.
 *
 * Walks every FILE under `jobs/<folder>/candidates/candidate_<id>/**` - recursively,
 * since a candidate folder can nest further (e.g. `interviews/round-N-record.json`) -
 * and encrypts whatever is still plaintext under `dataKey` via the same JPE1 envelope
 * `candidate-fs.ts` uses. A file that already starts with the JPE1 magic is left alone
 * and counted as skipped, so the sweep is idempotent by construction: a crash mid-run
 * (or running it again on an already-encrypted install) simply resumes/no-ops on the
 * files it hasn't touched yet.
 *
 * Crash safety: these are the boss's SOLE copies, so the rewrite is never in-place.
 * Each file's ciphertext is written to a sibling `<file>.jpenc-tmp` first, then moved
 * over the original via an atomic same-volume rename - at every instant the real path
 * holds EITHER the intact plaintext OR the complete ciphertext, never a truncated
 * hybrid (which the 4-byte JPE1 magic check would misclassify as done forever). A
 * crash mid-write only ever loses the temp, and the next sweep re-encrypts from the
 * untouched plaintext, consuming any stale temp in the process.
 *
 * Job- and company-level files (jd.md, inject.md, references/, question_bank.json,
 * learned_skills.md, email templates, and the `.keys/` master-key directory) all live
 * outside `jobs/*\/candidates/candidate_*\/` and are never visited - the same boundary
 * `candidate-fs.ts` enforces for individual reads/writes.
 *
 * `db` is accepted (not used) to match the `{ db, paths, dataKey }` shape every other
 * `*Deps` in this codebase uses (JobsDeps, InterviewDeps, ...); today's sweep is a pure
 * filesystem walk with nothing to look up in the database.
 */
export function sweepCandidateFiles({ paths, dataKey }: SweepDeps): SweepResult {
  const result: SweepResult = { encrypted: 0, skipped: 0 }
  if (!fs.existsSync(paths.jobsDir)) return result

  for (const jobEntry of fs.readdirSync(paths.jobsDir, { withFileTypes: true })) {
    if (!jobEntry.isDirectory()) continue
    const candidatesDir = path.join(paths.jobsDir, jobEntry.name, 'candidates')
    if (!fs.existsSync(candidatesDir)) continue

    for (const candEntry of fs.readdirSync(candidatesDir, { withFileTypes: true })) {
      if (!candEntry.isDirectory() || !candEntry.name.startsWith('candidate_')) continue
      sweepDir(path.join(candidatesDir, candEntry.name), dataKey, result)
    }
  }
  return result
}

function sweepDir(dir: string, key: Buffer, result: SweepResult): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      sweepDir(full, key, result)
    } else if (entry.isFile()) {
      if (entry.name.endsWith(TMP_SUFFIX)) continue // leftover from a crashed run, not a candidate file
      const buf = fs.readFileSync(full)
      if (isEncrypted(buf)) {
        result.skipped++
        continue
      }
      const tmp = full + TMP_SUFFIX
      try {
        fs.writeFileSync(tmp, encryptBuffer(key, buf))
        renameSyncWithRetry(tmp, full) // atomic on the same volume; retries Windows AV/indexer locks
      } catch (e) {
        try {
          fs.rmSync(tmp, { force: true }) // best-effort: a failed sweep must not litter temps
        } catch {
          /* the rethrown error below is the one that matters */
        }
        throw e
      }
      result.encrypted++
    }
  }
}
