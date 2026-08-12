import { formatPaisa, type Paisa } from "@/lib/money";

/**
 * Renders a paisa amount as "Rs 599.00" with `tabular-nums` — Part 15.
 * POS screens are ~80% numbers; without tabular figures, a live total
 * or clock visibly jitters as its digits change width. This is the one
 * place every screen should render money, instead of calling
 * `formatPaisa()` directly and forgetting the tabular-nums class.
 */
export function Money({
  paisa,
  className = "",
}: {
  paisa: Paisa | number;
  className?: string;
}) {
  return <span className={`tabular-nums ${className}`}>{formatPaisa(paisa)}</span>;
}
