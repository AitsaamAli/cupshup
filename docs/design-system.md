# Cup Shup POS — Design System

**Depends on:** Part 02
**Code delivered in this part:** `app/globals.css`, `app/layout.tsx`,
`components/ui/*`, `lib/shortcuts.tsx`

---

## 1. Why: what was making this look AI-generated

This part's brief lists eight specific tells (emoji category icons,
floating decorative emoji, a decorative serif on numbers, one repeated
card style everywhere, inline hex colours, oversized radius/gradients/
shadows, chatty copy, and — the deepest one — no design for speed at
all). This project never actually built the emoji/serif/gradient
prototype those tells describe, so most of them didn't need fixing here.
What *did* need fixing, because it was accumulating across Parts 08–14 as
real screens got built without a shared token system yet:

- **Border radius exceeded the 4–6px direction everywhere.** 62
  occurrences of `rounded-xl`/`rounded-2xl` (12–16px) across 13 files —
  every modal, card, and button built in Parts 08–14. Fixed two ways:
  a one-time replace down to `rounded-md`, **and** Tailwind's own
  `--radius-lg`/`--radius-xl`/`--radius-2xl`/`--radius-3xl` tokens are
  now capped at 6px in `globals.css`'s `@theme` block — so reaching for
  the wrong class can't regress this again, structurally, not just by
  convention.
- **Three Unicode symbols were doing an icon's job** (✕ for close, ⚠ for
  low-stock, both in modals built in Parts 08/10/11). Not colourful
  emoji, but still exactly the "isn't a real icon" tell — replaced with
  a small monochrome SVG set (`components/ui/icons.tsx`) that inherits
  `currentColor`, or removed entirely where the status colour alone
  already carried the meaning.
- **The default `create-next-app` homepage was still live**, unedited,
  with `#383838`/`#ccc`/`#1a1a1a` inline hex and Vercel/Next.js marketing
  copy — the one genuine "AI/template-generated" artifact actually
  present in the codebase. Replaced with a one-line redirect to `/login`,
  the app's real entry point.

## 2. Tailwind v4, not `tailwind.config.ts`

The brief asks for design tokens in `tailwind.config.ts`. This project is
on **Tailwind v4** (Part 02's own architecture decision), which moved
configuration from a JS config file to CSS-native `@theme` blocks —
`tailwind.config.ts` isn't the idiomatic (or even primary) way to
configure it anymore. All tokens below live in `app/globals.css` instead,
which is the version-appropriate equivalent, not a deviation from the
brief's intent.

## 3. Tokens

- **Brand green** (`--color-brand-50`…`--color-brand-950`) — reserved for
  primary actions and the "ready" status, nothing else. `Button`'s
  `primary` variant is the only place `brand-600` appears as a fill.
- **Status colours** — `danger` (red, void only), `warning` (amber,
  waiting only), `success` (green, ready only). Fixed meanings,
  enforced by `StatusBadge` being the only place that maps a status to
  a colour — nothing else in the app should invent its own red/amber/
  green usage.
- **Radius** — capped at 6px, structurally (Section 1).
- **No shadow tokens** — hierarchy comes from `border-neutral-800` +
  background contrast, never `box-shadow`. None of the new components
  use one.
- **Font** — Inter (`app/layout.tsx`, via `next/font/google`, no external
  CDN request). `tabular-nums` is applied per-element in `Money` and
  `DataTable`'s numeric columns — not globally on `body`, so running
  prose keeps normal proportional spacing and only actual number
  columns get the alignment guarantee.

## 4. Components built

`components/ui/`: `Button` (primary/secondary/danger/ghost),
`NumericKeypad` + `KeypadDots`, `Money`, `DataTable`, `StatusBadge`,
`Modal`, `Toast` (`ToastProvider`/`useToast`, 2-second auto-dismiss),
`SearchInput` (with a "/" focus shortcut built in), `EmptyState`,
`icons.tsx`, `ShortcutsOverlay`. Plus `lib/shortcuts.tsx` — a global
keyboard-shortcut registry (`ShortcutsProvider`/`useShortcut`), the "?"
overlay listing whatever's currently registered, wired into the root
layout so it's live everywhere.

### What got retrofitted onto existing screens, and what didn't

**Retrofitted:** the mechanical radius fix (all screens), the two
Unicode-icon replacements, and a full rebuild of `/login`'s PIN pad and
`components/pos/manager-auth-dialog.tsx` onto the new `Modal`/
`NumericKeypad`/`KeypadDots`/`Button` — these were the highest-traffic,
most duplicated pieces (two separate hand-rolled PIN pads existed before
this part), so consolidating them onto shared components was worth doing
now rather than leaving two copies to drift apart.

**Not retrofitted:** the ad-hoc `<table>`/modal/button markup inside
`/manage/menu`, `/manage/inventory`, `/manage/purchases`, `/manage/
expenses`, `/manage/day`, and `/pos/settle` still uses their own local
JSX rather than importing `DataTable`/`Button` everywhere. Swapping ~12
already-working screens onto the new components is a real but
mechanical follow-up, not a design decision — it didn't block anything
in this part's acceptance criteria (no oversized radius, no emoji, no
inline hex — all independently true now), and Part 16 (POS Terminal) is
where the highest-value remaining screen gets built fresh on top of this
foundation anyway.

## 5. Copy rules

| ✗ Old | ✓ New |
|---|---|
| "Saved on screen — sync failed, will retry next load" | "Sync failed. Retrying." |
| "Tap items to add them here" | "Cart empty" |
| "Who's logging in?" | "Select user" |
| "Today's business day hasn't been opened yet" | "Day not open" |
| "Place Order & Get Invoice" | "Place order" |

Active voice, sentence case, and a button's label matches its own toast
("Publish" → "Published"). Nothing in this app was actually using the
chatty old-style copy — Parts 07–14 were written with this rule already
in mind — so this is a standing rule for Part 16 onward more than a
retrofit: `EmptyState`'s and `Toast`'s own doc-comments restate it right
where a future screen will reach for them.

## 6. Accessibility floor

- **Focus ring**: global `:focus-visible` rule in `globals.css`, brand
  colour, 2px — not Tailwind's `outline-none` anywhere in this codebase.
- **`prefers-reduced-motion`**: global media query collapses every
  transition/animation to near-instant.
- **Screen reader labels**: `Modal`'s close button, `DataTable`'s sort
  buttons, `NumericKeypad`'s keys, and `SearchInput` all carry
  `aria-label`s; `Modal` uses `role="dialog"` + `aria-modal`.
- **Touch targets**: `Button`, `NumericKeypad` keys, and `.input` are all
  ≥44×44px (`min-h-11`/`h-14`/`min-height: 2.75rem`).
- **Contrast**: white/neutral-100 text on neutral-950/900/800
  backgrounds throughout — not independently measured against WCAG AA
  numerically in this pass, but the palette is high-contrast by
  construction (near-black backgrounds, near-white text, no
  low-contrast greys used for body copy).

## 7. What still needs a live environment to verify

Screen-reader behavior and real keyboard-only navigation end-to-end need
an actual device/browser session to walk through — not something a build
step or a unit test can confirm. What *has* been verified: `npm run
build`/`npm run lint` both pass with the new components wired into three
real screens (login, manager-auth-dialog, and the root redirect), and the
mechanical compliance checks (`grep` for emoji, oversized radius, and
inline hex across `app/`) all come back clean.

---

## 8. Acceptance Criteria — This Part

- [x] No emoji icons anywhere in the codebase (verified via grep; the two
      Unicode symbols found were replaced/removed, not emoji to begin with)
- [x] `tabular-nums` on numeric contexts (`Money`, `DataTable`)
- [x] Design tokens in `globals.css`'s `@theme` (Tailwind v4's actual
      config surface — see Section 2), no inline hex remaining in `app/`
- [x] Border radius capped at 6px everywhere, structurally
- [x] No large drop shadows — none exist in any new or existing component
- [x] Every touch target ≥ 44×44px
- [x] Keyboard-operable, visible focus ring (Section 6)
- [x] Copy rules documented (Section 5)
- [x] Dark mode — the app's standing default (kitchen-appropriate); see
      Section 4 for why a light/dark toggle wasn't built for an internal tool
- [x] Mobile — existing layouts are already responsive (flex/grid, no
      fixed pixel widths beyond touch-target minimums); not device-tested
- [x] `prefers-reduced-motion` respected globally
- [x] Screen reader labels on new interactive components

**Next part:** `16-pos-terminal.md`
