import { describe, it, expect } from "vitest";
import { buildVerifyOtpArgs } from "../lib/auth-otp";

describe("buildVerifyOtpArgs — Case E regression (email must never accompany token_hash)", () => {
  it("returns exactly type + token_hash", () => {
    expect(buildVerifyOtpArgs("some-hash")).toEqual({ type: "magiclink", token_hash: "some-hash" });
  });

  it("never includes an email key, under any input", () => {
    const result = buildVerifyOtpArgs("another-hash") as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(["token_hash", "type"]);
    expect("email" in result).toBe(false);
  });

  it("passes the token_hash through unmodified", () => {
    const hash = "abc123def456";
    expect(buildVerifyOtpArgs(hash).token_hash).toBe(hash);
  });
});
