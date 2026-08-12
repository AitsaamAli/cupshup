# Cup Shup POS — Auth & Staff Login Design

**Depends on:** Part 04 (RLS)
**Code delivered in this part:** `supabase/migrations/0002_auth_functions.sql`,
`app/api/auth/pin/route.ts`, `lib/supabase/admin.ts`, `lib/auth.ts`,
`app/(auth)/login/page.tsx`

---

## 1. The old system

```js
const USERS = [{ code: "OWN001", name: "Faizan Awan", password: "owner8888", ... }];
if (selected.password !== password) { setError("Incorrect password"); return; }
```

Every password lived in the JavaScript bundle, readable by anyone who opened
DevTools. There was no session, no expiry, no lockout — log in once, stay in
forever, on any device.

---

## 2. The design this part actually builds — and one deliberate change from the brief

The brief for this part describes a two-layer model: a long-lived **device**
login (Supabase Auth, email+password, saved to the tablet) underneath a
short-lived **staff PIN** on top. That's the right instinct — staff shouldn't
type an email and password before every order — but implementing it exactly
as a separate device identity would break something the rest of this project
already depends on.

**Why:** every RPC function built so far and still to come
(`current_staff()`, `has_role()`, `void_order()`'s `authorised_by`,
`place_order()`'s `created_by`, ...) determines "who is doing this" from
`auth.uid()`. If every staff member on a shared tablet were acting under one
common *device* identity, `auth.uid()` would always resolve to the same
person no matter who actually tapped the screen — and the entire
accountability model this project is built around (every void has a real
authoriser, every order has a real creator) would silently collapse into
"the tablet did it."

**What's built instead:** PIN entry *is* the login — it directly establishes
that specific staff member's own real Supabase session, rather than sitting
on top of a separate shared device session. The "long-lived, saved to the
device" property from the brief is preserved anyway, because that's just
normal Supabase session persistence: once staff member A has signed in on a
tablet, their session (and Supabase's refresh token) survives app restarts
on its own. Nothing device-specific has to be built for that part — it's
the idle-timeout (Section 5) and an explicit "not me" tap on the staff grid
that end a session early, not a missing device layer.

### The flow

```
1. Staff taps their name on the login screen
   (list_active_staff() — name + role only, safe pre-login)
        │
        ▼
2. Staff enters their PIN on the on-screen pad
        │
        ▼
3. Browser POSTs { staffId, pin } to app/api/auth/pin (server-only route)
        │
        ▼
4. Route calls verify_staff_pin(staffId, pin) using the SERVICE ROLE key
   - bcrypt-compares the PIN server-side, inside Postgres
   - checks the rolling 5-attempts/15-minute lockout
   - writes pin_failed / pin_success to audit_log either way
        │
        ├─ fails ──────────────────► 401, generic error, PIN cleared
        │
        ▼ succeeds
5. First-ever login for this staff member? Route provisions an
   auth.users row for them via the Admin API (random, unusable,
   never-shown password — the PIN is the only real credential) and
   links it via staff.user_id.
        │
        ▼
6. Route calls the Admin API's generateLink() to mint a one-time
   magic-link token for that staff member's real account, and returns
   ONLY the token hash + email to the browser. The admin session itself
   never leaves this server-only route.
        │
        ▼
7. Browser calls supabase.auth.verifyOtp({ type: 'magiclink', email,
   token_hash }) with the public anon-key client — this is a normal,
   public Supabase Auth operation. It establishes a REAL session for
   THAT staff member specifically.
        │
        ▼
8. auth.uid() now genuinely equals this staff member, for every RLS
   check and RPC call, until they lock out or explicitly switch.
        │
        ▼
9. Role-based redirect: owner/manager -> /reports/dashboard,
   cashier/supervisor -> /pos, chef/kitchen/barista -> /kds.
```

The service role key is used in exactly one place in this entire app —
`app/api/auth/pin/route.ts` — and never leaves the server. This is the
sanctioned exception to Part 02's "service role key never reaches the
browser" rule: it's read only inside a Route Handler, which runs on the
server, and the browser only ever receives a single-use, short-lived token
hash — never the admin session or the key itself.

---

## 3. Why PINs are never compared on the client

`verify_staff_pin()` runs entirely inside Postgres, comparing the submitted
PIN against `staff.pin_hash` using `pgcrypto`'s `crypt()` (bcrypt). The
browser never receives a hash to compare against, never holds the real PIN
longer than the moment it's typed and sent, and the Route Handler that calls
this function does so with the service role key — which itself is never
sent to or readable by the browser.

## 4. Weak-PIN rejection and lockout

`set_staff_pin()` (owner/manager only, called from that manager's own real,
already-authenticated session) rejects:
- Anything not 4–6 digits
- A fixed list of common weak PINs: `0000`, `1111`...`9999`, `1234`, `4321`,
  `0123`, `1212`, `2580` (a straight vertical line on a phone keypad), and
  their 6-digit equivalents.

`verify_staff_pin()` enforces a **rolling lockout**: 5 failed attempts for a
given staff member within the last 15 minutes blocks further tries. This
reuses `audit_log` (already append-only) rather than adding a separate
lockout table or column — the lock naturally lifts once the 5th-most-recent
failure ages out of the 15-minute window, with no cleanup job needed.

## 5. Session rules

| Screen | Idle timeout |
|---|---|
| POS | 15 minutes → PIN required again |
| Master P&L | 5 minutes → PIN required again, **every single time** |
| KDS | none — the kitchen screen stays open |

Implemented in `lib/auth.ts`'s `useStaffSession(screen)` hook. There is no
`masterAuthed`-style flag anywhere that, once set, stays set — every
timeout calls `supabase.auth.signOut()` and redirects to `/login`, full
stop. Master P&L (built in Part 18) re-locks faster than POS on purpose,
since it's the most sensitive screen in the system.

## 6. Multi-outlet note

`NEXT_PUBLIC_SUPABASE_OUTLET_ID` scopes the login screen's staff picker for
now, since Cup Shup is a single outlet. A real multi-outlet deployment would
need this to come from per-device configuration (e.g. set once when a
terminal is provisioned) rather than a single build-time environment
variable shared by every deployment — that's a Part 02 architecture
decision to revisit if/when a second location opens, not something this
part needed to solve today.

## 7. Provisioning the first staff member

`set_staff_pin()` requires an existing owner/manager session to call it —
which means the very first staff member (an owner) can't use it to set
their own initial PIN through the app; there's a bootstrapping step outside
the app for that first account. Until the Supabase project is linked, this
is: insert the first `staff` row directly (e.g. via the Supabase SQL editor)
with `pin_hash = crypt('<temporary-pin>', gen_salt('bf'))`, then log in with
that PIN through the app once and use `set_staff_pin()` (or the eventual
staff-management screen) for every account after that. There's no dedicated
"create staff" UI yet — Part 07's brief doesn't ask for one, and the
existing 20 parts don't name a dedicated "staff management" part either.
Flagging this as a real gap: something will need to own staff CRUD
(creating a new hire's row, assigning their role, setting their first PIN)
before this system is usable day-to-day beyond the seeded owner account.

---

## 8. What couldn't be verified in this environment

Everything in this part depends on a **live Supabase project** — the Admin
API calls (`createUser`, `generateLink`), the `verifyOtp` exchange, and the
PIN RPC itself all need a real running Postgres + Auth service to execute
against. Consistent with every part since Part 03, there's no Docker/local
Supabase and no linked project available here, so none of this flow has
been run end-to-end. What's been verified instead: the SQL was read
carefully for correctness (weak-PIN list, lockout math, `revoke`/`grant`
placement, RLS-bypass reasoning), and the TypeScript compiles and passes
lint under `npm run build`. Once a real project is linked, exercising the
full flow — including the two "Test:" lines below — is a manual
verification step for you to run, or something Part 20's test suite should
automate.

---

## 9. Acceptance Criteria — This Part

- [x] Supabase Auth performs the actual sign-in (via the PIN → magic-link
      exchange in Section 2) — re-scoped to per-staff sessions instead of a
      separate device login; see Section 2 for why
- [x] `staff.pin_hash` is bcrypt (`pgcrypto`'s `crypt()`); no plaintext PIN
      anywhere
- [x] `verify_staff_pin()` runs entirely server-side (Postgres, via the
      service-role-only Route Handler)
- [x] 5 failed attempts locks for 15 minutes (rolling window)
- [x] Every login, logout, and failed attempt writes to `audit_log`
      (`pin_success`, `pin_failed`, `logout`)
- [x] `middleware.ts` (Part 02) already redirects logged-out visitors to
      `/login` — unchanged by this part
- [x] Idle timeouts implemented per screen (`lib/auth.ts`)
- [x] `grep -i password` finds no hardcoded credential — the one place the
      word appears is the `password:` field name required by Supabase's
      `createUser()` API, filled with a freshly random, immediately
      discarded, never-logged value
- [ ] **Test:** attempting to open P&L after tampering with client state —
      can't be executed yet; the P&L screen doesn't exist until Part 18. The
      underlying guarantee (RLS blocking non-owners from `audit_log` /
      `daily_pl`, Part 04) is already in place, so this test should pass
      by construction once Part 18 ships the screen — nothing here needs to
      add that protection later, only to not undermine it.

**Next part:** `08-menu-management.md`
