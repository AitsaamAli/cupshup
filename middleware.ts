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
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
