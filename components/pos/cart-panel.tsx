"use client";

import { Button } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import type { Paisa } from "@/lib/money";
import type { SelectedModifier } from "@/components/pos/modifier-sheet";

export interface CartLine {
  lineId: string; // crypto.randomUUID() — NEVER the menu_item_id (Part 16's own rule:
  // the same item with different modifiers must be two separate lines).
  menuItemId: string;
  name: string;
  unitPricePaisa: number; // base price + modifier deltas, for display only
  qty: number;
  modifiers: SelectedModifier[];
  note?: string;
}

export interface ExistingLine {
  id: string;
  name_snapshot: string;
  qty: number;
  line_total_paisa: number;
}

/**
 * The order-in-progress panel — Part 16. Shows already-sent lines
 * (read-only, when resuming an open table) separately from the new
 * draft cart, since only the draft can still be edited before sending.
 */
export function CartPanel({
  existingLines,
  cart,
  pendingQty,
  onIncrement,
  onDecrement,
  onRemove,
  onSend,
  sending,
  sendLabel,
  canSend,
}: {
  existingLines: ExistingLine[];
  cart: CartLine[];
  pendingQty: number | null;
  onIncrement: (lineId: string) => void;
  onDecrement: (lineId: string) => void;
  onRemove: (lineId: string) => void;
  onSend: () => void;
  sending: boolean;
  sendLabel: string;
  canSend: boolean;
}) {
  const existingTotal = existingLines.reduce((s, l) => s + l.line_total_paisa, 0);
  const cartTotal = cart.reduce((s, l) => s + l.unitPricePaisa * l.qty, 0);

  return (
    <div className="flex h-full flex-col border-l border-line bg-surface p-4">
      <h2 className="mb-3 text-terminal-base font-semibold text-ink-900">Order</h2>

      {pendingQty !== null && (
        <p className="mb-2 rounded-md bg-warning/10 px-2 py-1 text-portal-xs text-warning">
          Qty ready: {pendingQty} — pick an item
        </p>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto">
        {existingLines.length > 0 && (
          <div>
            <p className="mb-1 text-portal-2xs font-medium uppercase tracking-wide text-ink-500">Already sent</p>
            <ul className="space-y-1">
              {existingLines.map((l) => (
                <li key={l.id} className="flex justify-between text-terminal-sm text-ink-500">
                  <span>
                    {l.qty}× {l.name_snapshot}
                  </span>
                  <Money paisa={l.line_total_paisa as Paisa} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {cart.length > 0 && (
          <div>
            <p className="mb-1 text-portal-2xs font-medium uppercase tracking-wide text-ink-500">New</p>
            <ul className="space-y-2">
              {cart.map((line) => (
                <li key={line.lineId} className="rounded-md border border-line p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-terminal-sm text-ink-900">{line.name}</p>
                      {line.modifiers.length > 0 && (
                        <p className="text-portal-xs text-ink-500">{line.modifiers.map((m) => m.name).join(", ")}</p>
                      )}
                      {line.note && <p className="text-portal-xs text-ink-300">&quot;{line.note}&quot;</p>}
                    </div>
                    <Money paisa={(line.unitPricePaisa * line.qty) as Paisa} className="text-terminal-sm text-ink-900" />
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      onClick={() => onDecrement(line.lineId)}
                      aria-label={`Decrease quantity of ${line.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-sm border border-line text-terminal-sm text-ink-700 hover:bg-canvas"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-terminal-sm tabular-nums text-ink-900">{line.qty}</span>
                    <button
                      onClick={() => onIncrement(line.lineId)}
                      aria-label={`Increase quantity of ${line.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-sm border border-line text-terminal-sm text-ink-700 hover:bg-canvas"
                    >
                      +
                    </button>
                    <button onClick={() => onRemove(line.lineId)} className="ml-auto text-portal-xs text-danger hover:underline">
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {existingLines.length === 0 && cart.length === 0 && <p className="text-portal-sm text-ink-500">Cart empty</p>}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <div className="mb-3 flex justify-between text-terminal-base font-semibold text-ink-900">
          <span>Subtotal</span>
          <Money paisa={(existingTotal + cartTotal) as Paisa} />
        </div>
        <Button variant="primary" density="terminal" className="w-full" disabled={!canSend || sending} onClick={onSend}>
          {sending ? "Sending…" : sendLabel}
        </Button>
      </div>
    </div>
  );
}
