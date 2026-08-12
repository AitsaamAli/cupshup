import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types";

/**
 * Supabase client for Client Components (anything with "use client" at the
 * top). Uses the public anon key — this is safe to ship to the browser
 * because every table is protected by Row Level Security (Part 04). This
 * client never has access to the service role key.
 *
 * Usage: `const supabase = createClient();` inside a client component.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
