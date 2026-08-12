/**
 * Builds the exact argument object for `supabase.auth.verifyOtp()` when
 * exchanging a PIN-login magic-link token for a real session
 * (app/(auth)/login/page.tsx).
 *
 * Regression guard for a real bug found live 2026-08-13 (audit Case E):
 * passing `email` alongside `token_hash` makes this project's
 * supabase-js/GoTrue version reject the call outright ("Only the
 * token_hash and type should be provided"), which made EVERY PIN login
 * fail at this exact step, regardless of how correct the PIN was.
 * Pulled into its own pure function specifically so the exact argument
 * shape has a permanent, direct test (tests/auth-otp.test.ts) instead
 * of only being verifiable by actually running the login flow in a
 * browser — which is exactly what let this bug go unnoticed through
 * every part of this build until it was actually used for the first time.
 */
export function buildVerifyOtpArgs(tokenHash: string): { type: "magiclink"; token_hash: string } {
  return { type: "magiclink", token_hash: tokenHash };
}
