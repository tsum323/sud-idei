import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  optional_context TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  visual_style TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_analyses (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  round INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (case_id, round, agent_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL,
  case_id TEXT NOT NULL REFERENCES cases(id),
  round INTEGER NOT NULL,
  agent_id TEXT,
  claim TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL,
  evidence_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cross_examinations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  round INTEGER NOT NULL,
  issue TEXT NOT NULL,
  original_agent_id TEXT NOT NULL,
  original_argument TEXT NOT NULL,
  counter_agent_id TEXT NOT NULL,
  counter_argument TEXT NOT NULL,
  resolution TEXT NOT NULL,
  impact TEXT NOT NULL,
  resolved INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verdicts (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  round INTEGER NOT NULL,
  decision TEXT NOT NULL,
  summary TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  scores TEXT NOT NULL,
  risks TEXT NOT NULL,
  unknowns TEXT NOT NULL,
  conditions_for_review TEXT NOT NULL,
  overall_score INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (case_id, round)
);

CREATE TABLE IF NOT EXISTS action_plans (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  round INTEGER NOT NULL,
  steps TEXT NOT NULL,
  validation_criteria TEXT NOT NULL,
  next_action TEXT NOT NULL,
  UNIQUE (case_id, round)
);

CREATE TABLE IF NOT EXISTS case_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  round INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_stages (
  case_id TEXT NOT NULL REFERENCES cases(id),
  round INTEGER NOT NULL,
  evidence TEXT NOT NULL DEFAULT 'idle',
  cross_exam TEXT NOT NULL DEFAULT 'idle',
  verdict TEXT NOT NULL DEFAULT 'idle',
  cross_exam_error TEXT,
  verdict_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (case_id, round)
);

CREATE INDEX IF NOT EXISTS idx_analyses_case ON agent_analyses(case_id, round);
CREATE INDEX IF NOT EXISTS idx_events_case ON case_events(case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence(case_id, round);
`;

export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

export function databasePath(): string {
  return process.env.DATABASE_PATH || "./data/ai-court.db";
}

const globalForDb = globalThis as unknown as { __aiCourtDb?: DatabaseSync };

/** Единственное соединение на процесс (переживает горячую перезагрузку в dev). */
export function getDb(): DatabaseSync {
  if (!globalForDb.__aiCourtDb) globalForDb.__aiCourtDb = openDatabase(databasePath());
  return globalForDb.__aiCourtDb;
}
