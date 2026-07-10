import type { DB } from '../db'
import type { JobpinPaths } from '../paths'
import { Gateway } from './gateway'
import { createQueue, type AnalysisQueue } from './queue'
import type { TokenIssuer } from './subscription'

export interface AiRuntime { gateway: Gateway; queue: AnalysisQueue }

export function createAiRuntime(opts: { db: DB; paths: JobpinPaths; issuer: TokenIssuer; fetchFn?: typeof fetch }): AiRuntime {
  const gateway = new Gateway({ db: opts.db, issuer: opts.issuer, fetchFn: opts.fetchFn })
  const queue = createQueue({ db: opts.db, paths: opts.paths, gateway })
  return { gateway, queue }
}
