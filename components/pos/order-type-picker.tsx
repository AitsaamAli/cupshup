"use client";

import { Button } from "@/components/ui/Button";
import type { OrderType } from "@/lib/orders";

/**
 * The very first thing a cashier picks. Dine-in goes to the table grid
 * next; takeaway/delivery skip straight to the item grid.
 */
export function OrderTypePicker({ onPick }: { onPick: (type: OrderType) => void }) {
  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col items-center justify-center gap-4 bg-canvas">
      <h1 className="mb-4 text-terminal-lg font-semibold text-ink-900">New order</h1>
      <div className="grid w-full max-w-sm grid-cols-1 gap-3">
        <Button variant="primary" density="terminal" className="h-16" onClick={() => onPick("dine_in")}>
          Dine-in
        </Button>
        <Button variant="secondary" density="terminal" className="h-16" onClick={() => onPick("takeaway")}>
          Takeaway
        </Button>
        <Button variant="secondary" density="terminal" className="h-16" onClick={() => onPick("delivery")}>
          Delivery
        </Button>
      </div>
    </div>
  );
}
