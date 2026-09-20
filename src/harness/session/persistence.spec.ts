import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SessionStore } from "./store.js";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "runtime-session-"));
  dirs.push(dir);
  return join(dir, "nested");
}
it("persists ordered messages and timestamps across instances and isolates sessions", () => {
  const dir = directory();
  const store = new SessionStore("one", dir);
  expect(store.exists()).toBe(false);
  expect(store.load().messages).toEqual([]);
  store.append(
    { role: "user", content: "hello" },
    new Date("2026-01-01T00:00:00Z"),
  );
  store.appendAll([
    { role: "assistant", content: "hi" },
    { role: "user", content: "next" },
  ]);
  const loaded = new SessionStore("one", dir);
  expect(loaded.exists()).toBe(true);
  expect(loaded.getMessageCount()).toBe(3);
  expect(loaded.load().messages.map((x) => x.content)).toEqual([
    "hello",
    "hi",
    "next",
  ]);
  expect(loaded.load().timestamps.get(0)).toBe(
    Date.parse("2026-01-01T00:00:00Z"),
  );
  expect(new SessionStore("two", dir).getMessageCount()).toBe(0);
});
it("recovers valid records around malformed lines and invalid timestamps", () => {
  const dir = directory();
  const store = new SessionStore("one", dir);
  const path = join(dir, "one.jsonl");
  writeFileSync(path, " \n");
  expect(store.load().messages).toEqual([]);
  store.append({ role: "user", content: "before" });
  appendFileSync(
    path,
    '\ninvalid json\n{"type":"metadata"}\n' +
      JSON.stringify({
        type: "message",
        timestamp: "invalid",
        message: { role: "assistant", content: "after" },
      }) +
      "\n",
  );
  expect(store.load().messages.map((x) => x.content)).toEqual([
    "before",
    "after",
  ]);
  expect(store.load().timestamps.has(1)).toBe(false);
});
