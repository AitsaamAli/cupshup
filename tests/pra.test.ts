import { describe, it, expect } from "vitest";
import { nextRetryDelayMs } from "../lib/pra";

describe("nextRetryDelayMs — mirrors record_pra_failure()'s SQL backoff", () => {
  it("doubles per attempt: 2, 4, 8 minutes", () => {
    expect(nextRetryDelayMs(1)).toBe(2 * 60_000);
    expect(nextRetryDelayMs(2)).toBe(4 * 60_000);
    expect(nextRetryDelayMs(3)).toBe(8 * 60_000);
  });

  it("caps at 60 minutes so a long outage never stops retrying entirely", () => {
    expect(nextRetryDelayMs(10)).toBe(60 * 60_000);
    expect(nextRetryDelayMs(100)).toBe(60 * 60_000);
  });
});
