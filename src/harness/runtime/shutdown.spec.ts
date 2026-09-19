import { describe, expect, it } from "vitest";
import { createRuntimeShutdown } from "./shutdown.js";

describe("createRuntimeShutdown", () => {
  it("closes every resource in order once even when one fails", async () => {
    const closed: string[] = [];
    const failures: string[] = [];
    const shutdown = createRuntimeShutdown(
      [
        {
          name: "cron",
          close: () => {
            closed.push("cron");
          },
        },
        {
          name: "channel",
          close: () => {
            closed.push("channel");
            throw new Error("stop failed");
          },
        },
        {
          name: "mcp",
          close: () => {
            closed.push("mcp");
            return Promise.resolve();
          },
        },
      ],
      (task) => failures.push(task),
    );

    expect(shutdown.started).toBe(false);
    await Promise.all([shutdown.run(), shutdown.run()]);

    expect(shutdown.started).toBe(true);
    expect(closed).toEqual(["cron", "channel", "mcp"]);
    expect(failures).toEqual(["channel"]);
  });
});
