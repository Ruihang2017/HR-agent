import fs from 'node:fs'
import type { JobpinPaths } from './paths'

/**
 * First-run scaffold (PRD 8.2). Creates missing directories/files only -
 * existing user files are NEVER overwritten (PRD Phase 0 scope).
 */
export function ensureScaffold(p: JobpinPaths): void {
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
}
