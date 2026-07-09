import os from 'node:os'
import path from 'node:path'

export interface JobpinPaths {
  dataRoot: string
  dbFile: string
  companyDir: string
  jobsDir: string
  companyMemoryFile: string
  valuesFile: string
  bossPreferencesFile: string
  legalTemplatesDir: string
  onboardingTemplatesDir: string
}

/** JOBPIN_DATA_DIR env override (tests, dev profiles), else <home>/jobpin-data (D-21). */
export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.JOBPIN_DATA_DIR
  if (override && override.trim() !== '') return override
  return path.join(os.homedir(), 'jobpin-data')
}

export function getPaths(dataRoot: string = resolveDataRoot()): JobpinPaths {
  const companyDir = path.join(dataRoot, 'company')
  return {
    dataRoot,
    dbFile: path.join(dataRoot, 'jobpin.db'),
    companyDir,
    jobsDir: path.join(dataRoot, 'jobs'),
    companyMemoryFile: path.join(companyDir, 'company_memory.md'),
    valuesFile: path.join(companyDir, 'values.md'),
    bossPreferencesFile: path.join(companyDir, 'boss_preferences.json'),
    legalTemplatesDir: path.join(companyDir, 'legal_templates'),
    onboardingTemplatesDir: path.join(companyDir, 'onboarding_templates')
  }
}
