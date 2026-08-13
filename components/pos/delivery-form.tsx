"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { findCustomerByPhone, createCustomer, type Customer } from "@/lib/customers";

/**
 * Customer phone lookup for delivery. The delivery fee itself is
 * entered at settlement (settle_order()'s p_delivery_fee_paisa) — this
 * screen only needs to identify who the order is for and where it's
 * going before the cart starts.
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
    <div className="mx-auto max-w-sm bg-canvas p-6">
      <h1 className="mb-6 text-terminal-lg font-semibold text-ink-900">Delivery order</h1>

      {!customer ? (
        <div className="space-y-3">
          <Field label="Customer phone" htmlFor="delivery-phone">
            <div className="flex gap-2">
              <Input
                id="delivery-phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setNotFound(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && lookup()}
                autoFocus
              />
              <Button density="terminal" onClick={lookup} disabled={searching || !phone.trim()}>
                {searching ? "…" : "Find"}
              </Button>
            </div>
          </Field>

          {notFound && (
            <div className="space-y-3 rounded-lg border border-line bg-surface p-3">
              <p className="text-portal-sm text-ink-500">New customer — add their details.</p>
              <Field label="Name (optional)" htmlFor="delivery-name">
                <Input id="delivery-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Delivery address" htmlFor="delivery-address-new">
                <Input id="delivery-address-new" value={address} onChange={(e) => setAddress(e.target.value)} />
              </Field>
              {error && <p className="text-portal-sm text-danger">{error}</p>}
              <Button variant="primary" density="terminal" onClick={confirmNewCustomer} className="w-full">
                Save &amp; continue
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-portal-sm text-ink-700">
            {customer.name ?? "Customer"} — {customer.phone}
          </p>
          <Field label="Delivery address" htmlFor="delivery-address">
            <Input id="delivery-address" value={address} onChange={(e) => setAddress(e.target.value)} autoFocus />
          </Field>
          <Button
            variant="primary"
            density="terminal"
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
