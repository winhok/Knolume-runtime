import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateDelay, isRetryable } from "./retry.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent retry policy", () => {
  it("classifies retryable and non-retryable failures", () => {
    expect(isRetryable(new Error("HTTP 429 rate limited"))).toBe(true);
    expect(isRetryable(new Error("HTTP 500 upstream"))).toBe(true);
    expect(isRetryable(new Error("HTTP 401 unauthorized"))).toBe(false);
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryable(new Error("request timeout"))).toBe(true);
    expect(isRetryable("not an Error")).toBe(false);
  });

  it("calculates deterministic exponential backoff when jitter is centered", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(calculateDelay(1, 100, 10_000)).toBe(100);
    expect(calculateDelay(2, 100, 10_000)).toBe(200);
    expect(calculateDelay(3, 100, 10_000)).toBe(400);
  });

  it("caps the backoff before applying bounded jitter", () => {
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0).mockReturnValueOnce(1);

    expect(calculateDelay(10, 100, 1_000)).toBe(750);
    expect(calculateDelay(10, 100, 1_000)).toBe(1_250);
  });
});
