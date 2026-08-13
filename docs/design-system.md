# Cup Shup POS — Design System

Replaces the original Part 15 "Industrial Terminal" (dark-first, single
density) system with **"Pakistani Portal, Dual Density"** —
`00-MASTER-DESIGN-PROMPT.md`'s own name for it: Zameen.com's design
*language* (dense, card-based, thin borders, no shadows, small
disciplined type), never its logo/wordmark/brand assets, applied across
two density modes that share one token set.

## 1. Tokens (`app/globals.css`)

Everything lives in CSS custom properties under `:root`, mapped into
Tailwind v4's `@theme inline` block (this project has no
`tailwind.config.ts` — v4's config surface is CSS-native). No component
should ever contain an inline hex value; if one needs a colour, it reads
a token.

- **Colour**: `--brand-*` (green, primary actions only), `--ink-900/700/
  500/300` (text, three weights, never pure black), `--line` (the one
  border colour for the whole app), `--surface`/`--canvas` (card vs page
  background), `--status-success/warning/danger/info` (fixed meanings,
  never repurposed).
- **Type scale**, three independent scales registered as real Tailwind
  utilities (`text-portal-sm`, `text-terminal-lg`, `text-kds-xl`, …):
  Portal 11/12/13/15/18/24/32, Terminal 12/14/16/20/28 (bigger — tapped
  in a hurry), KDS 16/20/24/32/44 (read from 2 metres).
- **Radius**: capped at 8px everywhere via Tailwind's own radius scale
  (`rounded-xl`/`2xl`/`3xl` all resolve to the same 8px cap) — this isn't
  a one-time find-replace, it means a soft 12–16px "AI card" radius
  physically cannot render in this project again.
- **Elevation**: no drop shadow anywhere except `Modal` (the one
  documented exception: `0 4px 12px rgba(0,0,0,0.08)`). Hierarchy comes
  from `--line` + `--surface`/`--canvas` contrast only.
- **Motion**: 120ms ease-out on hover/active, nothing else;
  `prefers-reduced-motion` collapses all of it globally.

### KDS's dark scope

The one deliberate light/dark split. Wrap the KDS screen root in
`data-mode="kds"` and every token flips for that subtree only — a wall
screen read from 2 metres under bright kitchen lighting is a different
*device*, not a style preference, so it isn't forced into the rest of
the app's light mode for consistency's sake.

### Urdu

`Noto Nastaliq Urdu` is loaded in `app/layout.tsx` alongside Inter and
applies automatically to any `[lang="ur"]` subtree (`globals.css`). Full
`next-intl` routing + RTL mirroring + translated kitchen/KDS strings are
**deferred** — see §4.

## 2. Component library (`components/ui/`)

Every primitive takes a `density` prop where size/type genuinely differ
between Portal and Terminal (currently: `Button`, `Tabs`); everything
else (`Card`, `Input`/`Select`/`Field`, `Money`, `StatusBadge`, `Modal`,
`Toast`, `DataTable`, `SearchInput`, `EmptyState`, `NumericKeypad`,
`Breadcrumbs`, `FilterBar`, `Skeleton`, `KeyboardHint`, `ShortcutsOverlay`,
`icons.tsx`) uses one shared visual language regardless of where it's
mounted, since borders/radius/colour don't change by density — only
spacing and type size do, and those are supplied by the density-aware
components (`Button`, `Tabs`, `AppShell`) and by Tailwind's `text-portal-*`
/`text-terminal-*`/`text-kds-*` utilities applied at the call site.

New this pass: `Card`/`ToolCard`, `Input`/`Select`/`Field`, `Tabs`,
`Breadcrumbs`, `FilterBar`, `Skeleton`/`SkeletonRow`, `KeyboardHint`,
`AppShell`. Retrofitted from Part 15's dark palette onto the new light
tokens: `Button`, `Modal`, `Toast`, `SearchInput`, `EmptyState`,
`NumericKeypad`/`KeypadDots`, `DataTable`, `StatusBadge`,
`ShortcutsOverlay`. `Money` and `icons.tsx` needed no change — neither
ever referenced a colour token directly.

## 3. `AppShell`

The one page-chrome component every screen mounts inside
(`components/ui/AppShell.tsx`): header (wordmark, day-status pill, live
clock, EN/UR toggle, user chip) shared by both modes; Portal density adds
a left sidebar (`nav` prop) and a breadcrumb trail (`crumbs` prop);
Terminal density renders neither — just the header and full-height
working space underneath.

## 4. What this pass did NOT get to — explicitly, not silently

Per this project's own established standard (say what's real, don't
round up completeness):

- **The three signature screens' inner composed components are not yet
  retrofitted.** `AppShell` + the primitive library above are ready to
  use, but `components/pos/*` (`item-grid`, `cart-panel`,
  `modifier-sheet`, `table-picker`, `order-type-picker`, `delivery-form`,
  `void-order-dialog`, `offline-indicator`), `components/kds/*`
  (`station-tabs`, `ticket-card`, `ticket-time-report`), and
  `components/reports/*` (`kpi-tile`, `date-range-picker`,
  `hourly-heatmap`, `flags-panel`, and the four chart components) all
  still carry Part 15's dark `neutral-*` palette. Mounting `AppShell`
  around them today would produce a light chrome around dark interior
  panels — visually incoherent, not a finished state. This is real,
  substantial remaining work (each of those ~18 files individually), not
  a quick pass.
- **`next-intl` routing, RTL layout mirroring, and translated kitchen/
  KDS strings** — the Urdu *font* is wired in; the locale system itself
  is not.
- **PWA polish** (manifest icons/splash matching the new brand mark,
  KDS wake-lock) beyond what Part 20 already shipped.
- **A full responsive/breakpoint sweep** against the device matrix in
  `00-MASTER-DESIGN-PROMPT.md` (bottom-sheet-on-mobile, stacked-card
  tables, thumb-reach primary actions) — the tokens support it; the
  screens haven't been rebuilt against it yet.
- **Real zameen.com colour values** — `WebFetch` converts pages to
  markdown and strips CSS, so the hex values above are still the
  master prompt's own approximations, not colour-picked originals.

## 5. All three signature screens — done, plus login

`app/pos/page.tsx`, `app/kds/page.tsx`, `app/reports/dashboard/page.tsx`,
and `app/(auth)/login/page.tsx` (the actual first screen anyone sees,
retrofitted after it turned up in a screenshot) are all now fully on the
new token system, along with every component they compose:

- **POS** (terminal density, `AppShell`): `item-grid`, `cart-panel`,
  `modifier-sheet`, `table-picker`, `order-type-picker`, `delivery-form`,
  `void-order-dialog`, `manager-auth-dialog`, `offline-indicator`,
  `components/print/pending-prints-indicator`. The `1`–`9` digit badges
  on the item grid render through `KeyboardHint` — the signature
  keyboard-first element made visually explicit.
- **KDS** (`data-mode="kds"`, its dark scope): `ticket-card`,
  `station-tabs`, `ticket-time-report`. Every token — including inside
  `<Modal>`, with zero KDS-specific code in `Modal.tsx` itself — resolves
  to its dark value automatically via CSS custom-property cascade.
- **Dashboard** (portal density, `AppShell` + sidebar + breadcrumbs +
  `FilterBar`): `kpi-tile`, `date-range-picker`, `hourly-heatmap`,
  `payment-mix-chart`, `revenue-bar-chart` (Recharts colours now read
  `var(--brand-600)`/`var(--line)`/`var(--ink-*)` directly, not hardcoded
  hex), `export-panel` (needed no change — already built on `Button`).
- **Login**: staff grid + PIN pad, same terminal-scale treatment as POS.

Verified after every batch with `tsc --noEmit` (clean) and a full
`next build` (24/24 pages, zero errors) — most recently after fixing a
real scare: a screenshot showed `/login` rendering in the browser's raw
default serif font on a plain white background, which turned out to be
a stale/conflicting `next dev` process colliding with a `.next` deletion
during verification, not a real CSS defect — confirmed by a clean build
throughout. `body`'s `font-family` is now set explicitly (defense in
depth) rather than relying solely on Tailwind's `--font-sans` preflight
inference.

Still deferred, unchanged from §4: `next-intl`/RTL routing, translated
kitchen/KDS strings, PWA polish, and the full responsive breakpoint
sweep. `menu-matrix-chart`/`flags-panel` (used on `/reports/pl`, not one
of the three named screens) and the rest of `/manage/*` remain on Part
15's dark palette.

## 6. Second benchmark pass — Toast/Square/Linear/Stripe, not Zameen

Zameen was the wrong reference class (a browsing portal, not a
transaction tool) and was replaced with real POS/ops software: **Toast
POS**/**Square** for the order screen, **Toast KDS** for the kitchen
board, **Linear** for speed/keyboard conventions, **Stripe Dashboard**
for reports, **Xero**/**Ramp** for cash/expenses, **Petpooja**/**Foodics**
for local market fit. Only interaction *patterns* were taken — no
screenshots, logos, or pixel-for-pixel UI from any of them.

**Palette refined** to the second pass's exact values (`--brand-600
#1A7F5A`, `--ink-900 #121A16`, `--line #E2E7E4`, `--canvas #F7F9F8`,
`--danger #B93E33`, `--warning #B8730A`, `--info #26628F`) — the same
token names, just corrected hex. **Naming note**: the spec's density
values are `console`/`terminal`/`kds`; this codebase kept the prop value
`density="portal"` from the first pass rather than doing a ~15-file
mechanical rename — `portal` **is** `console` under a different name,
nothing behaviourally different.

**Tap-count audit** (required by the spec's own "KAAM KA TAREEQA" — a
design isn't finished until this is measured, not estimated):

| Flow | Target | Measured | Verdict |
|---|---|---|---|
| 4-item takeaway order | ≤6 taps, ≤15s | Order type + 4× item pick + Send = 6 | ✅ |
| Cash settle, exact amount | ≤3 taps | Was: focus+type base, focus+type tendered, Settle — no shortcut existed at all | ❌ → **fixed** |
| Split settle | ≤6 taps | "+ Add split" × N + per-split fields + Settle | ⚠️ typing-heavy, not re-audited after the fix |
| Item void (manager PIN) | ≤5 taps | Void → reason → Confirm (+PIN if not already manager) | ✅/role-dependent |
| KDS bump | — (Toast KDS parity) | Was: 2 taps, no keyboard path | ❌ → **fixed** (1-9 bump bar) |

**Fixed this pass:**
- **Settlement screen** (`app/pos/settle/[orderId]/page.tsx`) — the
  actual tap-count failure. Added a one-tap **"Exact amount"** button
  that fills the default split's base *and* tendered (base + tax, not
  just base — under-tendering by the tax amount would have shown a
  false "no change owed") with the bill total. Full retrofit onto the
  design system alongside it (was still 100% Part 15 dark theme,
  hand-rolled void modal instead of the shared `Modal`).
- **`CommandPalette`** (`components/ui/CommandPalette.tsx`) — Cmd/Ctrl+K
  from anywhere, navigates to every major screen, arrow-key + Enter
  selection, `Esc` to close. Mounted once in `app/layout.tsx`; a small
  `⌘K` hint is visible in `AppShell`'s header (Linear's own rule: the
  shortcut is always shown, never hidden behind a tooltip).
- **KDS all-day counts strip + bump bar** — `allDayCounts()`
  (`lib/kds.ts`, pure and station-scoped, same shape as
  `ticketItemsForStation`) aggregates outstanding pending/preparing
  quantity per dish across every visible ticket ("12 Karak Chai") and
  renders as a strip under the station tabs. Bump bar: physical `1`-`9`
  bumps the ticket in that grid position straight to "All ready" — the
  same digit convention POS already uses for "pick item N" — with a
  `KeyboardHint` badge on each of the first nine tickets showing which
  key bumps it.

Verified: `tsc --noEmit` clean, full `next build` clean (24/24 pages)
after every change in this pass.

**Deferred, explicitly** — real, sizeable pieces, not started:
denomination counter (Xero-style cash counting, needs the business-day-
close screen which hasn't been touched at all yet), full report
drill-down (clicking a KPI number to its underlying orders), `BottomSheet`
component + the mobile responsive sweep, `OfflineBanner` as its own
named component (the equivalent exists inline as `offline-indicator.tsx`
but isn't factored out to match the spec's component list), split-settle
re-audit after the exact-amount change, `next-intl`/RTL, PWA polish.
