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
    <div className="flex h-full flex-col border-l border-neutral-900 p-4">
      <h2 className="mb-3 font-medium">Order</h2>

      {pendingQty !== null && (
        <p className="mb-2 text-xs text-amber-400">Qty ready: {pendingQty} — pick an item</p>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto">
        {existingLines.length > 0 && (
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-neutral-600">Already sent</p>
            <ul className="space-y-1">
              {existingLines.map((l) => (
                <li key={l.id} className="flex justify-between text-sm text-neutral-500">
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
            <p className="mb-1 text-xs uppercase tracking-wide text-neutral-600">New</p>
            <ul className="space-y-2">
              {cart.map((line) => (
                <li key={line.lineId} className="rounded-md border border-neutral-800 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm">{line.name}</p>
                      {line.modifiers.length > 0 && (
                        <p className="text-xs text-neutral-500">
                          {line.modifiers.map((m) => m.name).join(", ")}
                        </p>
                      )}
                      {line.note && <p className="text-xs text-neutral-600">&quot;{line.note}&quot;</p>}
                    </div>
                    <Money paisa={(line.unitPricePaisa * line.qty) as Paisa} className="text-sm" />
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      onClick={() => onDecrement(line.lineId)}
                      aria-label={`Decrease quantity of ${line.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-sm border border-neutral-700 text-sm"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm tabular-nums">{line.qty}</span>
                    <button
                      onClick={() => onIncrement(line.lineId)}
                      aria-label={`Increase quantity of ${line.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-sm border border-neutral-700 text-sm"
                    >
                      +
                    </button>
                    <button
                      onClick={() => onRemove(line.lineId)}
                      className="ml-auto text-xs text-red-400 underline"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {existingLines.length === 0 && cart.length === 0 && (
          <p className="text-sm text-neutral-500">Cart empty</p>
        )}
      </div>

      <div className="mt-3 border-t border-neutral-800 pt-3">
        <div className="mb-3 flex justify-between text-sm font-medium">
          <span>Subtotal</span>
          <Money paisa={(existingTotal + cartTotal) as Paisa} />
        </div>
        <Button variant="primary" className="w-full" disabled={!canSend || sending} onClick={onSend}>
          {sending ? "Sending…" : sendLabel}
        </Button>
      </div>
    </div>
  );
}
