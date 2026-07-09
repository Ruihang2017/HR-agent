import type { Migration } from '../db'
import { migration0001 } from './0001_init'

/** Ordered list of all migrations. Append-only; never edit a shipped migration. */
export const migrations: Migration[] = [migration0001]
