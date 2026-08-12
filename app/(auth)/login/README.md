# app/(auth)/login

Staff PIN login screen. A staff member enters their outlet-specific code + PIN
(not a shared password) to start a session tied to their `staff` row and the
terminal they're using. Built out fully in **Part 07 — Auth & Staff Login**.

The `(auth)` folder name is a Next.js **route group** — the parentheses mean
this segment doesn't show up in the URL (the page lives at `/login`, not
`/auth/login`). It exists so auth-related routes can later share their own
layout without affecting the rest of the app's URL structure.
