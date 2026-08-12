# components/ui

Shared design-system primitives — **built in Part 15**, on the tokens
defined in `app/globals.css` (`@theme`, Tailwind v4's CSS-native config
surface — see `docs/design-system.md` §2 for why there's no
`tailwind.config.ts`).

- `Button` — primary (brand green, reserved for THE primary action)/
  secondary/danger/ghost.
- `NumericKeypad` + `KeypadDots` — PIN/quantity/cash-tendered entry.
- `Money` — paisa → "Rs 599.00", `tabular-nums`.
- `DataTable` — sortable, numeric columns right-aligned and tabular.
- `StatusBadge` — void (red) / waiting (amber) / ready (green), fixed
  meanings, never reused for anything else.
- `Modal` — closes on Escape, capped radius, no shadow.
- `Toast` (`ToastProvider`/`useToast`) — 2-second auto-dismiss, short copy.
- `SearchInput` — built-in "/" focus shortcut.
- `EmptyState` — an invitation, not a statement of absence.
- `icons.tsx` — small monochrome SVG set; the reason nothing in this app
  reaches for an emoji or a Unicode dingbat as a stand-in icon.
- `ShortcutsOverlay` — the "?" screen, paired with `lib/shortcuts.tsx`'s
  registry.

Nothing in here should know about POS/KDS/inventory business logic — it
should stay reusable in any screen. `components/pos/` composes these
into POS-specific pieces (e.g. `manager-auth-dialog.tsx`, rebuilt on
`Modal`/`NumericKeypad` in this same part).

See `docs/design-system.md` for the full token list, copy rules, and
which existing screens have (and haven't yet) been retrofitted onto
these components.
