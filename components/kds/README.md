# components/kds

KDS-specific components — Part 17. Deliberately not built on the shared
`components/ui/Button` for the tap targets: this screen needs a 64×64px
minimum, not the 44px the rest of the app uses, and relying on Tailwind
className string concatenation to override one utility with another of
the same kind is order-dependent — not safe for a requirement this
literal. See `docs/kitchen-display.md` for the full reasoning.

- `station-tabs.tsx` — "All stations" plus the four station buttons
  (Hot Kitchen, Cold/Bar, Chai/Coffee, Bakery).
- `ticket-card.tsx` — one ticket: age-coloured border, item rows that
  advance pending → preparing → ready on tap, per-item 86 button, and
  the "All ready" / "Recall" action for the ticket as a whole.
- `ticket-time-report.tsx` — the average-ticket-time modal (per ticket,
  per station, per hour), scoped to the currently open business day.
