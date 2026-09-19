import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionLedger, type SessionScope } from "./ledger.js";

const tempDirs: string[] = [];
const scope: SessionScope = { productId: "example", userId: "user-1", sessionId: "session-1" };

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SessionLedger", () => {
  it("commits completed Turns to canonical history and excludes failed Turns", () => {
    const ledger = createLedger();
    ledger.beginTurn(scope, "run-1");
    ledger.completeTurn(scope, "run-1", [
      { role: "user", content: "one" },
      { role: "assistant", content: "answer one" },
    ]);
    ledger.beginTurn(scope, "run-2");
    ledger.terminalizeTurn(scope, "run-2", "failed");

    expect(ledger.loadCanonicalHistory(scope)).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "answer one" },
    ]);
    expect(ledger.getTurn("run-2")?.state).toBe("failed");
    ledger.close();
  });

  it("rejects dangling Tool calls from canonical history", () => {
    const ledger = createLedger();
    ledger.beginTurn(scope, "run-1");

    expect(() =>
      ledger.completeTurn(scope, "run-1", [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "grep",
              input: { pattern: "TODO" },
            },
          ],
        },
      ]),
    ).toThrow(/dangling Tool calls/);
    expect(ledger.getTurn("run-1")?.state).toBe("in_progress");
    ledger.close();
  });

  it("marks abandoned in-progress Turns as interrupted before serving history", () => {
    const dir = makeTempDir();
    const dbPath = join(dir, "sessions.db");
    const first = new SessionLedger(dbPath);
    first.beginTurn(scope, "run-1");
    first.close();

    const reopened = new SessionLedger(dbPath);
    expect(reopened.reconcileInterruptedTurns()).toBe(1);
    expect(reopened.getTurn("run-1")?.state).toBe("interrupted");
    expect(reopened.loadCanonicalHistory(scope)).toEqual([]);
    reopened.close();
  });
});

function createLedger(): SessionLedger {
  return new SessionLedger(join(makeTempDir(), "sessions.db"));
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kernifold-session-ledger-test-"));
  tempDirs.push(dir);
  return dir;
}
