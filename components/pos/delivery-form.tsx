"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { findCustomerByPhone, createCustomer, type Customer } from "@/lib/customers";

/**
 * Customer phone lookup for delivery — Part 16. The delivery fee itself
 * is entered at settlement (Part 10's screen already has that field,
 * settle_order()'s p_delivery_fee_paisa) — this screen only needs to
 * identify who the order is for and where it's going before the cart
 * starts.
 */
export function DeliveryForm({
  outletId,
  onReady,
}: {
  outletId: string;
  onReady: (customer: Customer, address: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!phone.trim()) return;
    setSearching(true);
    setError(null);
    setNotFound(false);
    try {
      const found = await findCustomerByPhone(outletId, phone.trim());
      if (found) {
        setCustomer(found);
        setAddress(found.address ?? "");
      } else {
        setNotFound(true);
      }
    } finally {
      setSearching(false);
    }
  }

  async function confirmNewCustomer() {
    setError(null);
    try {
      const created = await createCustomer(outletId, phone.trim(), {
        name: name || undefined,
        address: address || undefined,
      });
      setCustomer(created);
      setNotFound(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-sm p-6">
      <h1 className="mb-6 text-xl font-semibold">Delivery order</h1>

      {!customer ? (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Customer phone</span>
            <div className="flex gap-2">
              <input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setNotFound(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && lookup()}
                className="input"
                autoFocus
              />
              <Button onClick={lookup} disabled={searching || !phone.trim()}>
                {searching ? "…" : "Find"}
              </Button>
            </div>
          </label>

          {notFound && (
            <div className="space-y-3 rounded-md border border-neutral-800 p-3">
              <p className="text-sm text-neutral-400">New customer — add their details.</p>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Name (optional)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Delivery address</span>
                <input value={address} onChange={(e) => setAddress(e.target.value)} className="input" />
              </label>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button variant="primary" onClick={confirmNewCustomer} className="w-full">
                Save &amp; continue
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-300">
            {customer.name ?? "Customer"} — {customer.phone}
          </p>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Delivery address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="input" autoFocus />
          </label>
          <Button
            variant="primary"
            className="w-full"
            disabled={!address.trim()}
            onClick={() => onReady(customer, address.trim())}
          >
            Continue to menu
          </Button>
        </div>
      )}
    </div>
  );
}
