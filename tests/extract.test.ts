import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractText, extOf } from '../src/server/extract'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const read = (f: string) => new Uint8Array(fs.readFileSync(path.join(fixtures, f)))

describe('extOf', () => {
  it('lowercases and strips the dot', () => {
    expect(extOf('Resume.PDF')).toBe('pdf')
    expect(extOf('notes')).toBe('')
  })
})

describe('extractText', () => {
  it('reads txt', async () => {
    const r = await extractText(read('sample.txt'), 'txt')
    expect('text' in r && r.text).toContain('espresso')
  })

  it('extracts pdf text', async () => {
    const r = await extractText(read('sample.pdf'), 'pdf')
    expect('text' in r && r.text).toContain('Hello Jobpin PDF resume')
  })

  it('extracts docx text', async () => {
    const r = await extractText(read('sample.docx'), 'docx')
    expect('text' in r && r.text).toContain('Hello Jobpin DOCX resume')
  })

  it('flags scanned/empty pdf as an error, without throwing', async () => {
    const r = await extractText(read('empty.pdf'), 'pdf')
    expect('error' in r && r.error).toMatch(/no extractable text/)
  })

  it('flags corrupt pdf as an error, without throwing', async () => {
    const r = await extractText(read('corrupt.pdf'), 'pdf')
    expect('error' in r).toBe(true)
  })

  it('flags unsupported extensions', async () => {
    const r = await extractText(read('sample.txt'), 'pages')
    expect('error' in r && r.error).toMatch(/unsupported file type/)
  })
})
