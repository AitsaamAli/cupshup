# components/reports

Report-specific components — Part 18.

- `kpi-tile.tsx` — one labelled metric; the Dashboard/P&L grids are
  mostly a row of these.
- `date-range-picker.tsx` — from/to plus Today/Last 7 days/This month
  presets, drives every fetch on both report pages.
- `hourly-heatmap.tsx` — hand-rolled grid, not a Recharts chart type:
  Recharts has no native heatmap.
- `payment-mix-chart.tsx` — Recharts pie, payment method share.
- `revenue-bar-chart.tsx` — generic "revenue by label" bar chart, shared
  by the Dashboard's top-items and category-revenue charts.
- `menu-matrix-chart.tsx` — the Menu Engineering Matrix scatter (units
  sold vs. margin %), reference lines at the same median
  `classifyMenuItems()` (`lib/reports.ts`) classified against.
- `flags-panel.tsx` — the threshold-based flags list (Part 18 §4),
  replacing the old system's single always-wrong "net loss" alert.
- `export-panel.tsx` — the CSV download buttons (orders, payments,
  expenses, stock movements, PRA tax summary).

See `docs/reports-and-pl.md` for the manager-vs-owner visibility split
these all sit behind.
