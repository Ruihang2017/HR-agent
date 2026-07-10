import mammoth from 'mammoth'
import { extractText as unpdfExtractText, getDocumentProxy } from 'unpdf'

export type ExtractResult = { text: string } | { error: string }

export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase()
}

/**
 * File bytes -> text. NEVER throws: every failure becomes { error }, so the
 * candidate is flagged needs_review and the original is preserved (spec section 6).
 */
export async function extractText(bytes: Uint8Array, ext: string): Promise<ExtractResult> {
  const e = ext.toLowerCase().replace(/^\./, '')
  try {
    if (e === 'txt' || e === 'md') {
      return { text: Buffer.from(bytes).toString('utf8') }
    }
    if (e === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(bytes))
      const { text } = await unpdfExtractText(pdf, { mergePages: true })
      if (!text || text.trim() === '') return { error: 'no extractable text (scanned document?)' }
      return { text }
    }
    if (e === 'docx') {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
      if (!value || value.trim() === '') return { error: 'no extractable text in document' }
      return { text: value }
    }
    return { error: `unsupported file type .${e || '(none)'}` }
  } catch (err) {
    return { error: `extraction failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
