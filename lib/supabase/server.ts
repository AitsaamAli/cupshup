import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Reads/writes the session through cookies, so it always knows which staff
 * member is logged in on the server — which matters because ALL money math
 * and permission checks must happen server-side, never trusted from the
 * browser.
 *
 * Usage: `const supabase = await createClient();` — note this is async,
 * because reading cookies in the App Router requires awaiting `cookies()`.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // `setAll` was called from a Server Component, which can't set
            // cookies directly. This is safe to ignore as long as
            // middleware.ts is also refreshing the session — that's the
            // only place a session write actually needs to succeed.
          }
        },
      },
    }
  );
}
