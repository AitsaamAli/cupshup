import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Runs on every request (except static assets, see `matcher` below).
 * Two jobs:
 *   1. Refresh the Supabase auth session so it doesn't expire mid-shift.
 *   2. Redirect a logged-out staff member to /login for any non-public route.
 *
 * The real role-based rules (which role can reach which route) are enforced
 * again at the database level via RLS (Part 04) — this middleware is a
 * convenience redirect, not the security boundary.
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not add logic between createServerClient and getUser().
  // A dropped call here can randomly log staff out mid-shift.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicRoute = request.nextUrl.pathname.startsWith("/login");

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match every route except:
     * - Next.js internals (_next/static, _next/image)
     * - favicon.ico
     * - static asset files (svg, png, jpg, jpeg, gif, webp)
     * - sw.js / manifest.json (Part 20) — these must be servable with
     *   no session at all (a service worker registers itself before
     *   any login happens); without this exclusion the middleware was
     *   redirecting an unauthenticated /sw.js request to /login,
     *   handing the browser an HTML page where it expected JavaScript
     *   and silently breaking registration.
     * - api/* — a REAL bug, found live: app/api/auth/pin/route.ts is
     *   the PIN-verification call itself, made while the browser has
     *   NO session yet (that's the entire point of it). Without this
     *   exclusion, the middleware redirected that unauthenticated POST
     *   to /login, which returned the login PAGE's HTML with a 200 —
     *   the client's `res.json()` then threw trying to parse HTML as
     *   JSON, surfacing as "Network error — try again." on every
     *   single login attempt, correct PIN or not. Every API route
     *   handles its own auth internally already (RPC calls fail their
     *   own way when unauthenticated — see current_staff() checks
     *   throughout supabase/migrations/) — none of them need or want
     *   this middleware's redirect.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
