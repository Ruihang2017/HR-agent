import type { Migration } from '../db'
import { migration0001 } from './0001_init'
import { migration0002 } from './0002_analysis_queue'
import { migration0003 } from './0003_memory_event_status'
import { migration0004 } from './0004_snapshot_maintenance'

/** Ordered list of all migrations. Append-only; never edit a shipped migration. */
export const migrations: Migration[] = [migration0001, migration0002, migration0003, migration0004]
