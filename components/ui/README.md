# components/ui

Shared design-system primitives, on the tokens defined in
`app/globals.css` (`@theme`, Tailwind v4's CSS-native config surface —
no `tailwind.config.ts`). Rebuilt onto the **"Pakistani Portal, Dual
Density"** system — see `docs/design-system.md` for the full token list,
copy rules, and exactly what has (and hasn't yet) been retrofitted onto
these components.

- `AppShell` — the one page-chrome component every screen mounts
  inside: header (wordmark, day-status pill, clock, EN/UR toggle, user
  chip) + Portal sidebar/breadcrumbs or Terminal bare top bar.
- `Button` — primary (brand green, THE primary action)/secondary/
  danger/ghost/quiet, `density="portal" | "terminal"`.
- `Card` / `ToolCard` — thin-border block, no shadow; `ToolCard` is the
  icon+title+subtitle "Explore more"-shaped link tile.
- `Input` / `Select` / `Field` — labelled form controls on the shared
  `.input` class (`globals.css`).
- `Tabs` — controlled tab strip, `density="portal" | "terminal" | "kds"`.
- `Breadcrumbs` — Portal-density trail.
- `FilterBar` — sticky filter/action bar under a Portal header.
- `NumericKeypad` + `KeypadDots` — PIN/quantity/cash-tendered entry.
- `Money` — paisa → "Rs 599.00", `tabular-nums`.
- `DataTable` — sortable, numeric columns right-aligned and tabular,
  sticky header.
- `StatusBadge` — void (red) / waiting (amber) / ready (green), fixed
  meanings, never reused for anything else.
- `Modal` — closes on Escape, capped radius, the one deliberate shadow
  exception in the whole app.
- `Toast` (`ToastProvider`/`useToast`) — 2-second auto-dismiss, short copy.
- `SearchInput` — built-in "/" focus shortcut.
- `EmptyState` — an invitation, not a statement of absence.
- `Skeleton` / `SkeletonRow` — loading placeholder (never a spinner —
  see the "three visible states" rule in `docs/design-system.md`).
- `KeyboardHint` — the small monospace shortcut badge next to any
  actionable Terminal-density element; the design's one signature
  element.
- `icons.tsx` — small monochrome SVG set; the reason nothing in this app
  reaches for an emoji or a Unicode dingbat as a stand-in icon.
- `ShortcutsOverlay` — the "?" screen, paired with `lib/shortcuts.tsx`'s
  registry.

Nothing in here should know about POS/KDS/inventory business logic — it
stays reusable in any screen. `components/pos/`, `components/kds/`, and
`components/reports/` compose these into screen-specific pieces — **not
yet retrofitted onto this token system as of this pass**, see
`docs/design-system.md` §4.
