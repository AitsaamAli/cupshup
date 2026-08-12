"use client";

import { createClient } from "@/lib/supabase/client";

export interface Customer {
  id: string;
  outlet_id: string;
  phone: string;
  name: string | null;
  address: string | null;
  notes: string | null;
  loyalty_points: number;
}

/** Looks up a customer by phone for delivery orders — Part 16. Returns
 * null if no match, so the caller can fall back to createCustomer(). */
export async function findCustomerByPhone(outletId: string, phone: string): Promise<Customer | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("outlet_id", outletId)
    .eq("phone", phone)
    .maybeSingle();
  return (data as unknown as Customer | null) ?? null;
}

export async function createCustomer(
  outletId: string,
  phone: string,
  options: { name?: string; address?: string } = {}
): Promise<Customer> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({ outlet_id: outletId, phone, name: options.name ?? null, address: options.address ?? null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as Customer;
}

/** Updates the address on file — a returning delivery customer often
 * gives an updated address at the door. */
export async function updateCustomerAddress(customerId: string, address: string) {
  const supabase = createClient();
  const { error } = await supabase.from("customers").update({ address }).eq("id", customerId);
  if (error) throw new Error(error.message);
}
