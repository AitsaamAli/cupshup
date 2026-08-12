import pg from "pg";
import { FIXTURE_STAFF } from "./global-setup";

/**
 * Removes exactly what global-setup.ts created — every `E2E-`-prefixed
 * staff row, and (if the first-login flow actually ran during the
 * suite) the auth.users row it auto-provisioned for each. Runs even if
 * specs failed partway through, since Playwright always calls
 * globalTeardown after globalSetup regardless of test outcome.
 */
export default async function globalTeardown() {
  const dbUrl = process.env.E2E_DATABASE_URL;
  if (!dbUrl) return;

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const codes = FIXTURE_STAFF.map((s) => s.code);
    const { rows } = await client.query(
      `select user_id from staff where code = any($1) and user_id is not null`,
      [codes]
    );
    await client.query(`delete from staff where code = any($1)`, [codes]);
    for (const row of rows) {
      await client.query(`delete from auth.users where id = $1`, [row.user_id]);
    }
    console.log(`E2E fixtures: removed ${codes.length} staff row(s) and ${rows.length} provisioned auth user(s).`);
  } finally {
    await client.end();
  }
}
