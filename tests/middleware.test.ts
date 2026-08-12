import { describe, it, expect } from "vitest";
import { config } from "../middleware";

/**
 * Regression test for a real bug found live 2026-08-13 (audit Case D):
 * the middleware's matcher never excluded `/api/*`, so
 * app/api/auth/pin/route.ts — the PIN-verification call itself, made
 * with NO session yet, since that's the whole point of it — was being
 * redirected to /login by the same middleware that requires a session
 * for every other route. Every PIN login failed with a generic
 * "Network error" as a result: the client's `res.json()` choked trying
 * to parse the login PAGE's HTML instead of the expected JSON.
 *
 * The matcher pattern is a real JS-regex-compatible string (Next.js
 * supports this form directly) — tested here as an actual RegExp
 * against real pathnames, not just eyeballed.
 */
describe("middleware matcher — Case D regression (api/* must be excluded)", () => {
  const [pattern] = config.matcher;
  // Next.js compiles this matcher pattern anchored (^...$) — this is
  // the well-known "match everything except X" snippet from Next's own
  // middleware docs, and it only behaves correctly anchored: unanchored,
  // `.test()` would find a match starting from ANY later "/" in the
  // path (e.g. "/api/auth/pin" unanchored matches from "/auth/pin"
  // onward), silently hiding exactly the kind of bug this test exists
  // to catch. Anchoring here to match Next's real compiled behaviour.
  const matcher = new RegExp(`^${pattern}$`);

  it("excludes every /api/* route — the actual bug", () => {
    expect(matcher.test("/api/auth/pin")).toBe(false);
    expect(matcher.test("/api/pra/submit")).toBe(false);
  });

  it("excludes sw.js and manifest.json (Part 20's own earlier fix)", () => {
    expect(matcher.test("/sw.js")).toBe(false);
    expect(matcher.test("/manifest.json")).toBe(false);
  });

  it("excludes Next.js internals and favicon", () => {
    expect(matcher.test("/_next/static/chunk.js")).toBe(false);
    expect(matcher.test("/_next/image")).toBe(false);
    expect(matcher.test("/favicon.ico")).toBe(false);
  });

  it("excludes static asset extensions", () => {
    expect(matcher.test("/icon.svg")).toBe(false);
    expect(matcher.test("/logo.png")).toBe(false);
  });

  it("still matches every real protected page route — the exclusions must stay narrow", () => {
    expect(matcher.test("/pos")).toBe(true);
    expect(matcher.test("/kds")).toBe(true);
    expect(matcher.test("/reports/dashboard")).toBe(true);
    expect(matcher.test("/reports/pl")).toBe(true);
    expect(matcher.test("/manage/day")).toBe(true);
    expect(matcher.test("/login")).toBe(true);
  });
});
