import type { Migration } from '../db'

/** Migration 0002 (Phase 2): analysis queue + advisory usage metering. */
export const migration0002: Migration = {
  id: 2,
  name: 'analysis_queue',
  sql: `
CREATE TABLE analysis_tasks (
  id           INTEGER PRIMARY KEY,
  job_id       INTEGER NOT NULL REFERENCES jobs(id),
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  status       TEXT NOT NULL DEFAULT 'queued',
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX idx_analysis_tasks_job_id ON analysis_tasks(job_id);
CREATE INDEX idx_analysis_tasks_candidate_id ON analysis_tasks(candidate_id);

CREATE TABLE usage_events (
  id                INTEGER PRIMARY KEY,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  kind              TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  job_id            INTEGER,
  candidate_id      INTEGER,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_usage_events_created_at ON usage_events(created_at);
`
}
