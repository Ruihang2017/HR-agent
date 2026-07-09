import type { Migration } from '../db'

/**
 * Migration 0001: the full PRD section 8.1 schema - 13 tables.
 * Conventions (spec section 5):
 * - INTEGER PRIMARY KEY ids; ISO-8601 TEXT timestamps
 * - index on every FK column; NO ON DELETE CASCADE (deletion semantics are Phase 5, D-17)
 * - every *_path column stores a path RELATIVE to the jobpin-data root, never absolute,
 *   so a backed-up folder restores intact on any machine (F8.4)
 * - rankings/ranking_items are immutable by trigger (PRD invariant 11.1-5); Phase 5
 *   relaxes the delete triggers by migration once the deletion policy is decided
 */
export const migration0001: Migration = {
  id: 1,
  name: 'init',
  sql: `
-- ============ spec-defined tables (PRD section 8.1) ============

CREATE TABLE jobs (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  folder_path  TEXT NOT NULL,
  jd_path      TEXT,
  inject_path  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE candidates (
  id           INTEGER PRIMARY KEY,
  job_id       INTEGER NOT NULL REFERENCES jobs(id),
  name         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  status       TEXT NOT NULL DEFAULT 'new',
  current_rank INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_candidates_job_id ON candidates(job_id);

CREATE TABLE candidate_documents (
  id                   INTEGER PRIMARY KEY,
  candidate_id         INTEGER NOT NULL REFERENCES candidates(id),
  type                 TEXT NOT NULL,
  file_path            TEXT NOT NULL,
  extracted_text_path  TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_candidate_documents_candidate_id ON candidate_documents(candidate_id);

CREATE TABLE interviews (
  id              INTEGER PRIMARY KEY,
  candidate_id    INTEGER NOT NULL REFERENCES candidates(id),
  stage           INTEGER NOT NULL DEFAULT 1,
  mode            TEXT NOT NULL DEFAULT 'manual',
  scheduled_at    TEXT,
  transcript_path TEXT,
  summary_path    TEXT,
  ai_score        REAL,
  boss_decision   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_interviews_candidate_id ON interviews(candidate_id);

CREATE TABLE rankings (
  id         INTEGER PRIMARY KEY,
  job_id     INTEGER NOT NULL REFERENCES jobs(id),
  criteria   TEXT NOT NULL DEFAULT '[]',
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_rankings_job_id ON rankings(job_id);

CREATE TABLE ranking_items (
  id           INTEGER PRIMARY KEY,
  ranking_id   INTEGER NOT NULL REFERENCES rankings(id),
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  rank         INTEGER NOT NULL,
  score        REAL NOT NULL,
  reason       TEXT
);
CREATE INDEX idx_ranking_items_ranking_id ON ranking_items(ranking_id);
CREATE INDEX idx_ranking_items_candidate_id ON ranking_items(candidate_id);

CREATE TABLE memory_events (
  id               INTEGER PRIMARY KEY,
  scope            TEXT NOT NULL,
  scope_id         TEXT,
  source_type      TEXT,
  source_id        INTEGER,
  content          TEXT NOT NULL,
  approved_by_boss INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============ tables deferred to Phase 0 design (spec section 5) ============

CREATE TABLE interview_questions (
  id           INTEGER PRIMARY KEY,
  interview_id INTEGER NOT NULL REFERENCES interviews(id),
  order_index  INTEGER NOT NULL,
  category     TEXT NOT NULL,
  text         TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'generated',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_interview_questions_interview_id ON interview_questions(interview_id);

CREATE TABLE interview_answers (
  id                    INTEGER PRIMARY KEY,
  interview_question_id INTEGER NOT NULL REFERENCES interview_questions(id),
  answer_text           TEXT,
  boss_note             TEXT,
  ai_comment            TEXT,
  confidence            REAL,
  affects_ranking       INTEGER NOT NULL DEFAULT 0,
  source                TEXT NOT NULL DEFAULT 'manual',
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_interview_answers_question_id ON interview_answers(interview_question_id);

CREATE TABLE ai_analyses (
  id             INTEGER PRIMARY KEY,
  job_id         INTEGER REFERENCES jobs(id),
  candidate_id   INTEGER REFERENCES candidates(id),
  kind           TEXT NOT NULL,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_manifest TEXT NOT NULL DEFAULT '{}',
  output_path    TEXT,
  confidence     REAL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ai_analyses_job_id ON ai_analyses(job_id);
CREATE INDEX idx_ai_analyses_candidate_id ON ai_analyses(candidate_id);

CREATE TABLE emails (
  id           INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  type         TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_emails_candidate_id ON emails(candidate_id);

CREATE TABLE documents (
  id           INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  type         TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_documents_candidate_id ON documents(candidate_id);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============ ranking-snapshot immutability (PRD invariant 11.1-5) ============

CREATE TRIGGER trg_rankings_immutable_update
BEFORE UPDATE ON rankings
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_rankings_immutable_delete
BEFORE DELETE ON rankings
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_ranking_items_immutable_update
BEFORE UPDATE ON ranking_items
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_ranking_items_immutable_delete
BEFORE DELETE ON ranking_items
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;
`
}
