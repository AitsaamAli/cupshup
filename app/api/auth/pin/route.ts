import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Verifies a staff member's PIN and, on success, hands the browser a
 * one-time token it can exchange for that staff member's OWN real
 * Supabase session — so `auth.uid()` genuinely reflects who is acting,
 * which is what every RLS policy and RPC function (current_staff(),
 * has_role(), place_order(), ...) depends on for both permissions and
 * accountability (who authorised this void, who created this order).
 *
 * This is the ONLY place in the app the service role key is used. See
 * docs/auth-design.md for the full design and why it's shaped this way.
 *
 * Request:  POST { staffId: string, pin: string }
 * Response: { email, tokenHash, staff: { id, name, role } }
 *           — the browser then calls supabase.auth.verifyOtp({ type:
 *             'magiclink', email, token_hash: tokenHash }) with the
 *             public anon-key client to finish signing in.
 */
export async function POST(request: Request) {
  let body: { staffId?: string; pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { staffId, pin } = body;
  if (!staffId || !pin) {
    return NextResponse.json({ error: "staffId and pin are required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Step 1: verify the PIN server-side, inside Postgres. Never compared
  // in the browser. Failure messages here are deliberately the same
  // whether the PIN is wrong or the account is locked out — see
  // verify_staff_pin() in 0002_auth_functions.sql for the exact wording.
  const { data: verified, error: verifyError } = await admin.rpc("verify_staff_pin", {
    p_staff_id: staffId,
    p_pin: pin,
  });
  if (verifyError || !verified) {
    return NextResponse.json(
      { error: verifyError?.message ?? "AUTH: invalid PIN" },
      { status: 401 }
    );
  }

  type Verified = { staff_id: string; outlet_id: string; name: string; role: string; user_id: string | null };
  const v = verified as Verified;
  let userId = v.user_id;

  // Step 2: first-ever login for this staff member — provision their
  // auth.users row now. They never see or set this "password"; it's a
  // random, unusable-by-design value, because the only real sign-in path
  // for a staff member is this PIN exchange, never email+password.
  if (!userId) {
    const email = `staff-${v.staff_id}@staff.cupshup.internal`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: randomUUID() + randomUUID(),
      user_metadata: { staff_id: v.staff_id, name: v.name },
    });
    if (createError || !created?.user) {
      return NextResponse.json(
        { error: "Could not provision a login for this staff member" },
        { status: 500 }
      );
    }
    userId = created.user.id;

    const { error: linkError } = await admin
      .from("staff")
      .update({ user_id: userId })
      .eq("id", v.staff_id);
    if (linkError) {
      return NextResponse.json({ error: "Could not link the staff account" }, { status: 500 });
    }
  }

  const { data: userRecord, error: getUserError } = await admin.auth.admin.getUserById(userId);
  const email = userRecord?.user?.email;
  if (getUserError || !email) {
    return NextResponse.json({ error: "Could not resolve staff login" }, { status: 500 });
  }

  // Step 3: mint a one-time token. The admin session itself never leaves
  // this server-only route — only a short-lived, single-use token hash
  // does, which the browser exchanges for its own session via the public
  // (anon-key) verifyOtp() call.
  const { data: link, error: linkGenError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkGenError || !tokenHash) {
    return NextResponse.json({ error: "Could not start staff session" }, { status: 500 });
  }

  return NextResponse.json({
    email,
    tokenHash,
    staff: { id: v.staff_id, name: v.name, role: v.role },
  });
}
