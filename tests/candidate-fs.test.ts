import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import {
  writeCandidateFile, readCandidateFile, readCandidateFileText, existsCandidateFile,
  type CandidateFsDeps
} from '../src/server/candidate-fs'
import { FILE_MAGIC } from '../src/server/cryptx'
import { rmrfWithRetry } from './helpers'

let tmp: string
let paths: JobpinPaths

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-candidate-fs-'))
  paths = getPaths(tmp)
})

afterEach(() => {
  rmrfWithRetry(tmp)
})

const REL = 'jobs/acme/candidates/candidate_1/resume_text.md'

describe('writeCandidateFile / readCandidateFile - keyless', () => {
  it('mkdir -ps the parent and writes plain bytes identical to fs.writeFileSync', () => {
    const deps: CandidateFsDeps = { paths }
    writeCandidateFile(deps, REL, 'hello resume')
    const onDisk = fs.readFileSync(path.join(tmp, REL))
    expect(onDisk.toString('utf8')).toBe('hello resume')
    expect(onDisk.subarray(0, 4).equals(FILE_MAGIC)).toBe(false)
  })

  it('round-trips text and Buffer payloads', () => {
    const deps: CandidateFsDeps = { paths }
    writeCandidateFile(deps, REL, 'plain text')
    expect(readCandidateFileText(deps, REL)).toBe('plain text')

    const binRel = 'jobs/acme/candidates/candidate_1/resume.pdf'
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])
    writeCandidateFile(deps, binRel, bytes)
    expect(readCandidateFile(deps, binRel).equals(bytes)).toBe(true)
  })

  it('passthrough: a plain file on disk (no key ever used) reads back unchanged', () => {
    const deps: CandidateFsDeps = { paths }
    fs.mkdirSync(path.dirname(path.join(tmp, REL)), { recursive: true })
    fs.writeFileSync(path.join(tmp, REL), 'written directly via fs')
    expect(readCandidateFileText(deps, REL)).toBe('written directly via fs')
  })

  it('no key + an encrypted file on disk throws (never returns ciphertext)', () => {
    const deps: CandidateFsDeps = { paths }
    const key = randomBytes(32)
    const keyedDeps: CandidateFsDeps = { paths, dataKey: key }
    writeCandidateFile(keyedDeps, REL, 'secret content')
    expect(() => readCandidateFile(deps, REL)).toThrow('file is encrypted but no data key is available')
  })
})

describe('writeCandidateFile / readCandidateFile - keyed', () => {
  it('writes the JPE1 envelope on disk and decrypts back to the original bytes', () => {
    const key = randomBytes(32)
    const deps: CandidateFsDeps = { paths, dataKey: key }
    writeCandidateFile(deps, REL, 'secret resume text')

    const onDisk = fs.readFileSync(path.join(tmp, REL))
    expect(onDisk.subarray(0, 4).equals(FILE_MAGIC)).toBe(true)

    expect(readCandidateFileText(deps, REL)).toBe('secret resume text')
  })

  it('legacy window: key present + a plaintext file already on disk passes through unchanged', () => {
    fs.mkdirSync(path.dirname(path.join(tmp, REL)), { recursive: true })
    fs.writeFileSync(path.join(tmp, REL), 'pre-sweep legacy plaintext')

    const key = randomBytes(32)
    const deps: CandidateFsDeps = { paths, dataKey: key }
    expect(readCandidateFileText(deps, REL)).toBe('pre-sweep legacy plaintext')
  })

  it('wrong key on an encrypted file throws (GCM auth failure propagates)', () => {
    const deps: CandidateFsDeps = { paths, dataKey: randomBytes(32) }
    writeCandidateFile(deps, REL, 'secret')
    const wrongDeps: CandidateFsDeps = { paths, dataKey: randomBytes(32) }
    expect(() => readCandidateFile(wrongDeps, REL)).toThrow()
  })
})

describe('existsCandidateFile', () => {
  it('is true after a write and false for a path never written, independent of the key', () => {
    const deps: CandidateFsDeps = { paths, dataKey: randomBytes(32) }
    expect(existsCandidateFile(deps, REL)).toBe(false)
    writeCandidateFile(deps, REL, 'x')
    expect(existsCandidateFile(deps, REL)).toBe(true)
    expect(existsCandidateFile({ paths }, REL)).toBe(true) // existence doesn't care about the key
  })
})
