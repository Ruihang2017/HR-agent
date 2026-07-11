import type { Migration } from '../db'

/** Migration 0003 (Phase 3): proposal lifecycle on memory_events (pending/approved/rejected/refused). */
export const migration0003: Migration = {
  id: 3,
  name: 'memory_event_status',
  sql: `
ALTER TABLE memory_events ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
CREATE INDEX idx_memory_events_scope ON memory_events(scope, scope_id);
`
}
