import { describe, it, expect, afterEach } from "vitest";
import { isNetworkError } from "../lib/offline-network";

describe("isNetworkError", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("is true when the browser reports itself offline, regardless of the error", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    expect(isNetworkError(new Error("anything"))).toBe(true);
    expect(isNetworkError(undefined)).toBe(true);
  });

  it("is true for a fetch-shaped TypeError (Chrome's wording)", () => {
    const err = new TypeError("Failed to fetch");
    expect(isNetworkError(err)).toBe(true);
  });

  it("is true for a fetch-shaped TypeError (Safari's wording)", () => {
    const err = new TypeError("Load failed");
    expect(isNetworkError(err)).toBe(true);
  });

  it("is false for a real business-rule rejection (OrderError-shaped plain Error)", () => {
    const err = new Error("DAY: 2026-08-12 is closed — orders are blocked");
    expect(isNetworkError(err)).toBe(false);
  });

  it("is false for a TypeError that has nothing to do with the network", () => {
    const err = new TypeError("Cannot read properties of undefined");
    expect(isNetworkError(err)).toBe(false);
  });

  it("is false for a non-Error value while online", () => {
    expect(isNetworkError("just a string")).toBe(false);
  });
});
