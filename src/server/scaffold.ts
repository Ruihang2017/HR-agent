import fs from 'node:fs'
import path from 'node:path'
import type { JobpinPaths } from './paths'

export interface ScaffoldOptions {
  /**
   * Bundled `templates/au/emails` source dir (manifest.json + .hbs files).
   * Undefined (default) skips email-template seeding entirely, so existing
   * callers/tests are unaffected. When provided, every file in the source
   * dir is copied into `<dataRoot>/company/email_templates/` file-by-file,
   * only when the target file is absent (never overwrites a boss edit).
   */
  emailTemplatesSrc?: string
}

/**
 * First-run scaffold (PRD 8.2). Creates missing directories/files only -
 * existing user files are NEVER overwritten (PRD Phase 0 scope).
 */
export function ensureScaffold(p: JobpinPaths, opts: ScaffoldOptions = {}): void {
  const dirs = [p.dataRoot, p.companyDir, p.legalTemplatesDir, p.onboardingTemplatesDir, p.jobsDir]
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true })

  const seedFiles: Array<[string, string]> = [
    [p.companyMemoryFile, ''],
    [p.valuesFile, ''],
    [p.bossPreferencesFile, '{}\n']
  ]
  for (const [file, content] of seedFiles) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, content, 'utf8')
  }

  if (opts.emailTemplatesSrc) {
    const destDir = path.join(p.companyDir, 'email_templates')
    fs.mkdirSync(destDir, { recursive: true })
    for (const name of fs.readdirSync(opts.emailTemplatesSrc)) {
      const srcFile = path.join(opts.emailTemplatesSrc, name)
      if (!fs.statSync(srcFile).isFile()) continue
      const destFile = path.join(destDir, name)
      if (!fs.existsSync(destFile)) fs.copyFileSync(srcFile, destFile)
    }
  }
}
