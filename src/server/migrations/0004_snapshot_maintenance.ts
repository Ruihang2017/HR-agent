import type { Migration } from '../db'

/**
 * Migration 0004 (Phase 5): flag-gated maintenance paths for ranking snapshots.
 *
 * PRD invariant 11.1-5 says ranking snapshots are immutable — no ordinary write path may
 * touch them. Phase 5's deletion policy (Task 10) needs exactly two narrow exceptions:
 *   - scrubbing a candidate's PII out of a ranking_items.reason string, leaving every other
 *     column (ranking_id, candidate_id, rank, score) untouched
 *   - deleting a snapshot outright as part of a sanctioned data-deletion run
 * Both exceptions are gated behind a row in `maintenance_flags` that the deletion code must
 * insert immediately before the operation and remove immediately after — so the hole is only
 * open for the duration of a deliberate, flagged maintenance call, never for a stray UPDATE
 * or DELETE from anywhere else in the app. Every other write path still aborts exactly as
 * before this migration.
 */
export const migration0004: Migration = {
  id: 4,
  name: 'snapshot_maintenance',
  sql: `
CREATE TABLE maintenance_flags (flag TEXT PRIMARY KEY);

DROP TRIGGER trg_rankings_immutable_update;
DROP TRIGGER trg_rankings_immutable_delete;
DROP TRIGGER trg_ranking_items_immutable_update;
DROP TRIGGER trg_ranking_items_immutable_delete;

CREATE TRIGGER trg_rankings_immutable_update BEFORE UPDATE ON rankings
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_rankings_immutable_delete BEFORE DELETE ON rankings
WHEN NOT EXISTS (SELECT 1 FROM maintenance_flags WHERE flag = 'allow-snapshot-delete')
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_ranking_items_immutable_update BEFORE UPDATE ON ranking_items
WHEN NOT (EXISTS (SELECT 1 FROM maintenance_flags WHERE flag = 'allow-reason-scrub')
  AND NEW.ranking_id = OLD.ranking_id AND NEW.candidate_id = OLD.candidate_id
  AND NEW.rank = OLD.rank AND NEW.score = OLD.score)
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_ranking_items_immutable_delete BEFORE DELETE ON ranking_items
WHEN NOT EXISTS (SELECT 1 FROM maintenance_flags WHERE flag = 'allow-snapshot-delete')
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;
`
}
