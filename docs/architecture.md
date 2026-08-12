# Cup Shup POS — Architecture & Tech Stack

**Depends on:** Part 01 (Product Requirements)
**Output of this part:** this document + the `cupshup/` project scaffold

---

## 1. The stack, and why each piece was picked

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15, App Router** | Vercel's own framework — one project holds both the frontend (POS screens) and the backend (API routes, server logic), instead of running two separate services. |
| Language | **TypeScript, strict mode** | In plain JavaScript, `subtotal + tax` can silently become the string `"59900800"` instead of a number if either side is accidentally a string. TypeScript catches that at build time. In a system whose whole job is handling money correctly, that safety net is not optional. |
| Database | **Supabase (Postgres)** | See the comparison below — the short version is Realtime and built-in Row Level Security. |
| Styling | **Tailwind CSS v4** | Utility classes styled directly in components; Part 15 builds the actual design tokens (colors, spacing, type scale) on top of this. |
| Deploy | **Vercel** | Already the target platform; Next.js deploys to it with effectively zero configuration. |

### Supabase vs. Neon — why Supabase

Both are hosted Postgres, so at the database-engine level they're identical. The difference is everything Supabase bundles *around* Postgres:

| Capability | Supabase | Neon |
|---|---|---|
| Postgres | ✅ | ✅ |
| Row Level Security tooling | ✅ built-in dashboard + policies | ✅ (Postgres feature) but no tooling around it — you write and manage it entirely yourself |
| Auth (login, sessions, PIN-based staff login) | ✅ built-in | ❌ you build a whole auth system yourself |
| **Realtime** (live updates pushed to connected clients) | ✅ built-in | ❌ you'd stand up and run your own WebSocket server |
| File storage (e.g. expense receipt photos) | ✅ built-in | ❌ needs a separate service (S3, etc.) |
| Edge Functions (for the PRA eIMS webhook in Part 19) | ✅ built-in | ❌ needs a separate serverless platform |

**Realtime is the deciding factor.** The moment a cashier sends an order, it must appear on the Kitchen Display *instantly* — that is a hard product requirement (see `docs/requirements.md`, KDS Story 1: "within a couple of seconds... not manual refresh"). Building that from scratch on Neon means running and operating a WebSocket server yourself — realistically a month of extra engineering work for something Supabase already gives for free as `supabase.channel(...).on('postgres_changes', ...)`.

Neon would be the right call only if this project already had its own auth system and just needed a Postgres database sitting behind it. That's not this project — so Supabase is the clear choice.

---

## 2. Data flow

How a single order moves through the system, end to end:

```
┌─────────────┐        ┌───────────────────┐       ┌──────────────┐
│   Browser    │        │      Vercel        │       │   Supabase    │
│  (POS app,   │        │  (Next.js server)  │       │   (Postgres)  │
│  Client Comp)│        │                     │       │               │
└──────┬───────┘        └──────────┬──────────┘       └───────┬───────┘
       │                            │                          │
       │ 1. Cashier taps "Send      │                          │
       │    to Kitchen"             │                          │
       │──────────────────────────► │                          │
       │   supabase.rpc(            │                          │
       │    'place_order', {items}) │                          │
       │                            │  2. Server-side Supabase │
       │                            │     client (server.ts)   │
       │                            │     forwards the RPC     │
       │                            │─────────────────────────►│
       │                            │                           │
       │                            │      3. place_order()    │
       │                            │      runs INSIDE Postgres│
       │                            │      as one transaction: │
       │                            │      - validate day open │
       │                            │      - price items       │
       │                            │        server-side       │
       │                            │      - insert order +    │
       │                            │        order_items       │
       │                            │      - RLS checks the    │
       │                            │        caller's role     │
       │                            │◄─────────────────────────│
       │◄───────────────────────────│  4. order id returned    │
       │  5. POS shows "Sent"       │                           │
       │                            │                           │
       │                            │        6. Postgres commit │
       │                            │           fires a         │
       │                            │           Realtime event  │
       │                            │           on the orders/  │
       │                            │           order_items     │
       │                            │           tables          │
       │                            │                           │
┌──────┴───────┐                    │                    ┌──────┴───────┐
│  KDS screen   │◄───────────────────────────────────────│   Realtime    │
│ (subscribed   │        7. WebSocket push, no polling    │   channel     │
│  to channel)  │                                          └───────────────┘
└───────────────┘
```

The important part isn't the box-drawing — it's the principle it encodes: **the browser never decides a price or a permission.** It sends *intent* ("these items, this table"); Postgres (behind RLS, inside a single RPC function) decides what's actually allowed and what it costs. The Kitchen Display never asks "any new orders?" — Supabase Realtime pushes the change to it the instant Postgres commits.

---

## 3. Folder structure

```
cupshup/
├── app/
│   ├── (auth)/login/          # staff PIN login
│   ├── pos/                   # cashier terminal
│   ├── kds/                   # kitchen display
│   ├── manage/
│   │   ├── menu/
│   │   ├── inventory/
│   │   ├── expenses/
│   │   └── day/
│   ├── reports/
│   │   ├── dashboard/
│   │   └── pl/                # owner only
│   └── api/
│       └── pra/               # PRA eIMS webhook
├── components/
│   ├── ui/                    # Part 15's design system
│   └── pos/
├── lib/
│   ├── supabase/
│   │   ├── client.ts          # browser client
│   │   └── server.ts          # server client
│   ├── money.ts                # paisa helpers — Part 06
│   ├── business-date.ts        # trading-day helpers — Part 06
│   └── types.ts                 # database types (auto-generated)
├── supabase/
│   ├── migrations/             # SQL files, committed to git
│   └── seed.sql
├── tests/
├── docs/
├── middleware.ts
└── .env.local                  # git-ignored — see .env.local.example
```

Every one of these folders (except the ones that are self-explanatory) has its own small `README.md` explaining what belongs in it — open the folder to read it rather than duplicating that here.

---

## 4. Five rules that never get broken

These are load-bearing. Every part built after this one must respect them without exception:

1. **Migrations only — never hand-edit the schema in the Supabase dashboard.** Every table, column, or policy change is a numbered SQL file in `supabase/migrations/`, committed to git. A table clicked into existence in the dashboard exists only in that one environment — staging and production silently diverge, and nobody can tell you why a bug only happens in one of them.

2. **The service role key never reaches the browser.** It bypasses Row Level Security completely — anyone holding it can read or write any row in the database. It lives only in a server-only environment variable (never prefixed `NEXT_PUBLIC_`) and is used only from trusted server code, if it's needed at all beyond RLS.

3. **All money math happens on the server.** The browser sends "customer wants 2× Cappuccino, 1× Croissant." The server (inside a Postgres function, behind RLS) looks up the real price, applies the real tax rate, and computes the real total. The client displays what the server returned — it never computes a number that a payment gets trusted against.

4. **Financial tables are append-only.** Orders, payments, and stock movements are never `UPDATE`d or `DELETE`d after creation. A mistake is corrected by inserting a new reversal/adjustment row, not by editing history. This is what makes an audit possible six months later.

5. **`outlet_id` is on every business table, and every query is scoped by it.** Cup Shup is one outlet today, but the schema is written as if it could be ten tomorrow. RLS policies in Part 04 filter every row by the caller's outlet — this rule is what makes that possible without a rewrite later.

---

## 5. Environment variables

Copy `.env.local.example` to `.env.local` and fill in real values from your Supabase project (dashboard → Settings → API). **Never commit `.env.local`** — it's already listed in `.gitignore` via the `.env*` pattern.

| Variable | Where it's used | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | No — safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | No — safe to expose, because RLS (Part 04) protects every row anyway |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | **Yes.** Anything prefixed `NEXT_PUBLIC_` is bundled straight into browser JavaScript — this key must never carry that prefix. |

---

## 6. Deploying to Vercel

1. **Push `cupshup/` to a GitHub repository.** (A local git repo has not been initialised yet in this environment — Git for Windows isn't installed on this machine. Install it from git-scm.com, then from inside `cupshup/` run `git init`, `git add -A`, `git commit -m "Part 02: project scaffold"`, create a GitHub repo, and `git push`.)
2. Go to [vercel.com/new](https://vercel.com/new) and **import the GitHub repository**. Vercel auto-detects Next.js — no build configuration needed.
3. Before the first deploy, open **Project Settings → Environment Variables** and add the same three variables from `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) for the **Production** (and Preview, if you want staging previews to work) environment.
4. Click **Deploy**. Vercel runs `npm run build` and serves the result — this is the "empty page deploying" milestone from the acceptance criteria.
5. Every subsequent `git push` to the main branch triggers a new production deploy automatically; every push to any other branch gets its own preview URL.

---

## 7. What's still outstanding from this part

Two acceptance-criteria items need something this environment doesn't have, and can't be done on the user's behalf:

- **Git repository + first commit.** Git isn't installed on this machine (checked `git --version` and the standard install paths — none found). Install [Git for Windows](https://git-scm.com/download/win), then run the `git init` / `git add` / `git commit` sequence from Section 6 inside `cupshup/`.
- **Supabase project link + Vercel deploy.** Both require your own accounts and credentials, listed as pending items in `PROGRESS.md` ("Supabase account banana"). Once you have a Supabase project, run:
  ```
  npx supabase login
  npx supabase link --project-ref <your-project-ref>
  ```
  then fill in real values in `.env.local`, and follow Section 6 to deploy.

Everything else — the Next.js 15 + TypeScript (strict) + Tailwind v4 project, the full folder structure with per-folder README files, `lib/supabase/client.ts` and `server.ts`, `middleware.ts`, `lib/types.ts`, `.env.local.example`, and the `db:migrate` / `db:reset` / `db:types` / `test` npm scripts — is done and verified with a successful `npm run build`.
