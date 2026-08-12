"use client";

import { Button } from "@/components/ui/Button";
import type { OrderType } from "@/lib/orders";

/**
 * The very first thing a cashier picks — Part 16. Dine-in goes to the
 * table grid next; takeaway/delivery skip straight to the item grid.
 */
export function OrderTypePicker({ onPick }: { onPick: (type: OrderType) => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="mb-4 text-xl font-semibold">New order</h1>
      <div className="grid w-full max-w-sm grid-cols-1 gap-3">
        <Button variant="primary" className="h-16 text-base" onClick={() => onPick("dine_in")}>
          Dine-in
        </Button>
        <Button variant="secondary" className="h-16 text-base" onClick={() => onPick("takeaway")}>
          Takeaway
        </Button>
        <Button variant="secondary" className="h-16 text-base" onClick={() => onPick("delivery")}>
          Delivery
        </Button>
      </div>
    </div>
  );
}
