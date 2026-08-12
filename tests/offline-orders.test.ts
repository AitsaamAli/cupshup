import { describe, it, expect, afterEach } from "vitest";
import { classifySyncAttempt } from "../lib/offline-orders";

describe("classifySyncAttempt — decides what a queued order's sync attempt means", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("no error at all -> synced", () => {
    expect(classifySyncAttempt(null)).toBe("synced");
  });

  it("a network failure -> offline (stays queued, stop trying the rest of the batch)", () => {
    expect(classifySyncAttempt(new TypeError("Failed to fetch"))).toBe("offline");
  });

  it("the browser itself reports offline -> offline, regardless of the error shape", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    expect(classifySyncAttempt(new Error("anything"))).toBe("offline");
  });

  it("a real server rejection (day closed, item 86'd, ...) -> rejected, never retried again", () => {
    expect(classifySyncAttempt(new Error("DAY: 2026-08-12 is closed — orders are blocked"))).toBe("rejected");
    expect(classifySyncAttempt(new Error("ITEM: menu item unavailable"))).toBe("rejected");
  });
});
