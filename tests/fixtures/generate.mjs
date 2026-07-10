// One-time generator for extraction test fixtures. Run: node tests/fixtures/generate.mjs
// Outputs are committed so tests never depend on this script at runtime.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import JSZip from 'jszip'

const here = path.dirname(fileURLToPath(import.meta.url))

// sample.txt
fs.writeFileSync(path.join(here, 'sample.txt'), 'Alex Chen\nBarista with 3 years espresso experience.\n', 'utf8')

// sample.pdf - one page with real extractable text
{
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 200])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('Hello Jobpin PDF resume', { x: 40, y: 120, size: 14, font })
  fs.writeFileSync(path.join(here, 'sample.pdf'), await doc.save())
}

// empty.pdf - a valid PDF with a blank page (no extractable text)
{
  const doc = await PDFDocument.create()
  doc.addPage([400, 200])
  fs.writeFileSync(path.join(here, 'empty.pdf'), await doc.save())
}

// corrupt.pdf - not actually a PDF
fs.writeFileSync(path.join(here, 'corrupt.pdf'), '%PDF-1.4 this is not really a pdf')

// sample.docx - minimal WordprocessingML document mammoth can read
{
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Hello Jobpin DOCX resume</w:t></w:r></w:p></w:body>
</w:document>`
  )
  fs.writeFileSync(path.join(here, 'sample.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
}

console.log('fixtures generated')
