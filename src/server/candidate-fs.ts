import fs from 'node:fs'
import path from 'node:path'
import type { JobpinPaths } from './paths'
import { encryptBuffer, decryptBuffer, isEncrypted } from './cryptx'

/**
 * The candidate-file encryption seam (Task 6). Every read/write of a file under a
 * candidate's folder (`jobs/<f>/candidates/candidate_<id>/**`) goes through here instead
 * of raw `node:fs`, so a `dataKey` can be threaded in without touching call sites.
 * Company/job-level files (jd.md, inject.md, references/, learned_skills.md,
 * question_bank.json, email templates) are NOT candidate-tree files and must keep using
 * plain `node:fs` directly (D-17) - never route them through this module.
 */
export interface CandidateFsDeps {
  paths: JobpinPaths
  dataKey?: Buffer
}

function abs(deps: CandidateFsDeps, rel: string): string {
  return path.join(deps.paths.dataRoot, rel)
}

/** mkdir -p the parent directory, then write `data` - encrypted under `dataKey` when present, plain otherwise. */
export function writeCandidateFile(deps: CandidateFsDeps, rel: string, data: Buffer | string): void {
  const target = abs(deps, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const plain = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  fs.writeFileSync(target, deps.dataKey ? encryptBuffer(deps.dataKey, plain) : plain)
}

/**
 * Reads a candidate-tree file, decrypting when both a key is available AND the file is
 * actually encrypted (JPE1). Four cases:
 *  - key + JPE1        -> decrypt
 *  - key + NOT JPE1     -> passthrough (legacy plaintext left over from before the boot sweep)
 *  - no key + JPE1      -> throw (we cannot read it - never silently return ciphertext)
 *  - no key + not JPE1  -> passthrough (today's keyless behaviour, unchanged)
 */
export function readCandidateFile(deps: CandidateFsDeps, rel: string): Buffer {
  const buf = fs.readFileSync(abs(deps, rel))
  const encrypted = isEncrypted(buf)
  if (deps.dataKey) return encrypted ? decryptBuffer(deps.dataKey, buf) : buf
  if (encrypted) throw new Error('file is encrypted but no data key is available')
  return buf
}

export function readCandidateFileText(deps: CandidateFsDeps, rel: string): string {
  return readCandidateFile(deps, rel).toString('utf8')
}

/** Existence is not content, so this never needs to know about encryption. */
export function existsCandidateFile(deps: CandidateFsDeps, rel: string): boolean {
  return fs.existsSync(abs(deps, rel))
}
