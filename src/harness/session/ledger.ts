import Database from "better-sqlite3";
import type { ModelMessage } from "ai";

export interface SessionScope {
  productId: string;
  userId: string;
  sessionId: string;
}

export type SessionTurnState = "in_progress" | "completed" | "failed" | "cancelled" | "interrupted";

export interface SessionTurnRecord extends SessionScope {
  runId: string;
  state: SessionTurnState;
  canonicalMessages?: ModelMessage[];
}

interface SessionTurnRow {
  product_id: string;
  user_id: string;
  session_id: string;
  run_id: string;
  state: SessionTurnState;
  canonical_messages: string | null;
}

export class SessionLedger {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_turns (
        product_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        run_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        canonical_messages TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS session_turns_scope_idx
      ON session_turns(product_id, user_id, session_id, created_at);
    `);
  }

  beginTurn(scope: SessionScope, runId: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO session_turns
         (product_id, user_id, session_id, run_id, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'in_progress', ?, ?)`,
      )
      .run(scope.productId, scope.userId, scope.sessionId, runId, now, now);
  }

  completeTurn(scope: SessionScope, runId: string, messages: ModelMessage[]): void {
    assertStructurallyComplete(messages);
    const canonicalMessages = JSON.stringify(messages);
    const commit = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE session_turns
           SET state = 'completed', canonical_messages = ?, updated_at = ?
           WHERE product_id = ? AND user_id = ? AND session_id = ?
             AND run_id = ? AND state = 'in_progress'`,
        )
        .run(canonicalMessages, Date.now(), scope.productId, scope.userId, scope.sessionId, runId);
      if (result.changes !== 1) throw new Error(`Session Turn cannot be completed: ${runId}`);
    });
    commit();
  }

  terminalizeTurn(
    scope: SessionScope,
    runId: string,
    state: Exclude<SessionTurnState, "in_progress" | "completed">,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE session_turns
         SET state = ?, canonical_messages = NULL, updated_at = ?
         WHERE product_id = ? AND user_id = ? AND session_id = ?
           AND run_id = ? AND state = 'in_progress'`,
      )
      .run(state, Date.now(), scope.productId, scope.userId, scope.sessionId, runId);
    if (result.changes !== 1) throw new Error(`Session Turn cannot be terminalized: ${runId}`);
  }

  rollbackTurn(runId: string): void {
    this.db
      .prepare("DELETE FROM session_turns WHERE run_id = ? AND state = 'in_progress'")
      .run(runId);
  }

  loadCanonicalHistory(scope: SessionScope): ModelMessage[] {
    const rows = this.db
      .prepare(
        `SELECT canonical_messages
         FROM session_turns
         WHERE product_id = ? AND user_id = ? AND session_id = ? AND state = 'completed'
         ORDER BY created_at, rowid`,
      )
      .all(scope.productId, scope.userId, scope.sessionId) as Array<{
      canonical_messages: string;
    }>;
    return rows.flatMap((row) => JSON.parse(row.canonical_messages) as ModelMessage[]);
  }

  reconcileInterruptedTurns(): number {
    const result = this.db
      .prepare(
        `UPDATE session_turns
         SET state = 'interrupted', canonical_messages = NULL, updated_at = ?
         WHERE state = 'in_progress'`,
      )
      .run(Date.now());
    return result.changes;
  }

  getTurn(runId: string): SessionTurnRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT product_id, user_id, session_id, run_id, state, canonical_messages
         FROM session_turns WHERE run_id = ?`,
      )
      .get(runId) as SessionTurnRow | undefined;
    if (!row) return undefined;
    return {
      productId: row.product_id,
      userId: row.user_id,
      sessionId: row.session_id,
      runId: row.run_id,
      state: row.state,
      ...(row.canonical_messages
        ? { canonicalMessages: JSON.parse(row.canonical_messages) as ModelMessage[] }
        : {}),
    };
  }

  close(): void {
    this.db.close();
  }
}

function assertStructurallyComplete(messages: ModelMessage[]): void {
  const pendingToolCalls = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-call") {
        if (pendingToolCalls.has(part.toolCallId)) {
          throw new Error(`Canonical Session transcript repeats Tool call: ${part.toolCallId}`);
        }
        pendingToolCalls.add(part.toolCallId);
      }
      if (part.type === "tool-result" && !pendingToolCalls.delete(part.toolCallId)) {
        throw new Error(`Canonical Session transcript has orphan Tool result: ${part.toolCallId}`);
      }
    }
  }
  if (pendingToolCalls.size > 0) {
    throw new Error(
      `Canonical Session transcript has dangling Tool calls: ${[...pendingToolCalls].join(", ")}`,
    );
  }
}
