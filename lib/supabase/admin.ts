import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

/**
 * Service-role Supabase client. NEVER import this into a Client Component
 * or anything bundled for the browser — the service role key bypasses
 * Row Level Security entirely (Part 02's rule #2).
 *
 * It exists only for the small number of server-only operations that
 * genuinely need to act before a user has their own session — right now
 * that's exactly one thing: app/api/auth/pin/route.ts verifying a staff
 * PIN and minting that staff member's real session. Do not reach for
 * this client to "just make an RLS problem go away" anywhere else —
 * fix the RLS policy or the RPC instead.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
