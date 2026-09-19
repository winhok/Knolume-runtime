import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { AgentLoopStats } from "../agent/events.js";
import type { SubAgentRun } from "./types.js";

const TASK_PREVIEW_CHARS = 200;
const RESULT_PREVIEW_CHARS = 400;
const ERROR_PREVIEW_CHARS = 200;

export interface SubAgentRunScope {
  productId: string;
  userId: string;
  sessionId: string;
  rootRunId: string;
}

export type DurableSubAgentStatus = SubAgentRun["status"] | "interrupted";

export interface DurableSubAgentRun extends SubAgentRunScope {
  childRunId: string;
  profile: string;
  depth: number;
  taskPreview: string;
  status: DurableSubAgentStatus;
  startedAt: string;
  finishedAt?: string;
  resultPreview?: string;
  errorPreview?: string;
  stats?: AgentLoopStats;
}

export interface SubAgentRunObserver {
  onRunChanged(run: Readonly<SubAgentRun>): void;
}

interface SubAgentRunRow {
  product_id: string;
  user_id: string;
  session_id: string;
  root_run_id: string;
  child_run_id: string;
  profile: string;
  depth: number;
  task_preview: string;
  status: DurableSubAgentStatus;
  started_at: string;
  finished_at: string | null;
  result_preview: string | null;
  error_preview: string | null;
  stats_json: string | null;
}

export class SubAgentRunLedger {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sub_agent_runs (
        product_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        root_run_id TEXT NOT NULL,
        child_run_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        depth INTEGER NOT NULL,
        task_preview TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        result_preview TEXT,
        error_preview TEXT,
        stats_json TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (product_id, user_id, session_id, root_run_id, child_run_id)
      );

      CREATE INDEX IF NOT EXISTS sub_agent_runs_scope_idx
      ON sub_agent_runs(product_id, user_id, session_id, started_at DESC);
    `);
  }

  observer(scope: SubAgentRunScope): SubAgentRunObserver {
    return { onRunChanged: (run) => this.upsert(scope, run) };
  }

  upsert(scope: SubAgentRunScope, run: Readonly<SubAgentRun>): void {
    this.db
      .prepare(
        `INSERT INTO sub_agent_runs (
           product_id, user_id, session_id, root_run_id, child_run_id,
           profile, depth, task_preview, status, started_at, finished_at,
           result_preview, error_preview, stats_json, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(product_id, user_id, session_id, root_run_id, child_run_id)
         DO UPDATE SET
           status = excluded.status,
           finished_at = excluded.finished_at,
           result_preview = excluded.result_preview,
           error_preview = excluded.error_preview,
           stats_json = excluded.stats_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        scope.productId,
        scope.userId,
        scope.sessionId,
        scope.rootRunId,
        run.id,
        bounded(run.profile, 80),
        run.depth,
        bounded(run.task, TASK_PREVIEW_CHARS),
        run.status,
        run.startedAt,
        run.finishedAt ?? null,
        run.result === undefined ? null : bounded(run.result, RESULT_PREVIEW_CHARS),
        run.error === undefined ? null : bounded(run.error, ERROR_PREVIEW_CHARS),
        run.stats === undefined ? null : JSON.stringify(run.stats),
        Date.now(),
      );
  }

  recent(scope: Omit<SubAgentRunScope, "rootRunId">, limit = 20): DurableSubAgentRun[] {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const rows = this.db
      .prepare(
        `SELECT product_id, user_id, session_id, root_run_id, child_run_id,
                profile, depth, task_preview, status, started_at, finished_at,
                result_preview, error_preview, stats_json
         FROM sub_agent_runs
         WHERE product_id = ? AND user_id = ? AND session_id = ?
         ORDER BY started_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(scope.productId, scope.userId, scope.sessionId, boundedLimit) as SubAgentRunRow[];
    return rows.map(toRecord);
  }

  reconcileInterruptedRuns(): number {
    const now = new Date().toISOString();
    return this.db
      .prepare(
        `UPDATE sub_agent_runs
         SET status = 'interrupted', finished_at = ?,
             error_preview = 'AI service restarted before the child Run completed',
             updated_at = ?
         WHERE status = 'running'`,
      )
      .run(now, Date.now()).changes;
  }

  close(): void {
    this.db.close();
  }
}

function toRecord(row: SubAgentRunRow): DurableSubAgentRun {
  return {
    productId: row.product_id,
    userId: row.user_id,
    sessionId: row.session_id,
    rootRunId: row.root_run_id,
    childRunId: row.child_run_id,
    profile: row.profile,
    depth: row.depth,
    taskPreview: row.task_preview,
    status: row.status,
    startedAt: row.started_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(row.result_preview ? { resultPreview: row.result_preview } : {}),
    ...(row.error_preview ? { errorPreview: row.error_preview } : {}),
    ...(row.stats_json ? { stats: JSON.parse(row.stats_json) as AgentLoopStats } : {}),
  };
}

function bounded(value: string, maxChars: number): string {
  const sanitized = value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(api[-_]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ");
  const printable = Array.from(sanitized, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return printable.length <= maxChars ? printable : `${printable.slice(0, maxChars - 1)}…`;
}
