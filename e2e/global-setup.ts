import pg from "pg";

/**
 * Provisions real fixture staff directly in the database before the
 * E2E suite runs — deliberately NOT through the app's own signup flow
 * (there isn't one; staff are created by an owner via a screen this
 * project hasn't built a UI for yet) and deliberately NOT with a
 * pre-made auth.users row either: `user_id` is left null, exactly like
 * a genuinely new staff member, so the very first PIN login in
 * full-flow.spec.ts exercises the REAL first-login provisioning path
 * (app/api/auth/pin/route.ts's own auto-createUser branch) instead of
 * a shortcut around it.
 *
 * Every fixture row is prefixed `E2E-` (staff.code) so
 * global-teardown.ts can find and remove exactly these rows and
 * nothing else — this runs against the real linked project, not a
 * disposable database, so cleanup is not optional.
 */

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID ?? "00000000-0000-0000-0000-000000000001";

export const FIXTURE_STAFF = [
  { code: "E2E-OWNER", name: "E2E Test Owner", role: "owner", pin: "123456" },
  { code: "E2E-CASHIER", name: "E2E Test Cashier", role: "cashier", pin: "111111" },
  { code: "E2E-CHEF", name: "E2E Test Chef", role: "chef", pin: "222222" },
] as const;

export default async function globalSetup() {
  const dbUrl = process.env.E2E_DATABASE_URL;
  if (!dbUrl) {
    console.warn(
      "E2E_DATABASE_URL not set — skipping fixture provisioning. Specs that need real staff/day state will fail to log in. See docs/testing-strategy.md §5."
    );
    return;
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    for (const s of FIXTURE_STAFF) {
      await client.query(
        `insert into staff (outlet_id, code, name, role, pin_hash, active)
         values ($1, $2, $3, $4, crypt($5, gen_salt('bf')), true)
         on conflict (outlet_id, code) do update set pin_hash = excluded.pin_hash, active = true`,
        [OUTLET_ID, s.code, s.name, s.role, s.pin]
      );
    }
    console.log(`E2E fixtures: ${FIXTURE_STAFF.length} staff rows ready.`);
  } finally {
    await client.end();
  }
}
