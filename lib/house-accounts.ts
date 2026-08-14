"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";
import type { PaymentMethod } from "@/lib/settlement";

export interface HouseAccount {
  id: string;
  outlet_id: string;
  customer_id: string | null;
  name: string;
  credit_limit_paisa: number;
  billing_day: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface HouseAccountBalanceRow {
  account_id: string;
  outlet_id: string;
  customer_id: string | null;
  name: string;
  credit_limit_paisa: number;
  billing_day: number;
  active: boolean;
  charged_paisa: number;
  paid_paisa: number;
  outstanding_paisa: number;
}

export interface HouseAccountCharge {
  id: string;
  account_id: string;
  order_id: string;
  payment_id: string | null;
  amount_paisa: number;
  created_at: string;
}

export interface HouseAccountPayment {
  id: string;
  account_id: string;
  amount_paisa: number;
  method: PaymentMethod;
  note: string | null;
  received_by: string | null;
  created_at: string;
}

/**
 * House accounts (Khata/Credit) — Patch 1 per
 * restaurant-system-master-prompt.md §4.5. Balances always come from
 * `house_account_balances` (0047's view, security_invoker so RLS still
 * applies), never re-summed ad hoc here or anywhere else — same
 * single-source-of-truth rule the master prompt's §4.1 requires.
 */
export function useHouseAccounts(outletId: string) {
  const [accounts, setAccounts] = useState<HouseAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("house_accounts")
      .select("*")
      .eq("outlet_id", outletId)
      .order("name");
    setAccounts(castRows<HouseAccount>(data));
    setLoading(false);
  }, [outletId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { accounts, loading, reload };
}

export function useHouseAccountBalances(outletId: string) {
  const [rows, setRows] = useState<HouseAccountBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("house_account_balances")
      .select("*")
      .eq("outlet_id", outletId)
      .order("name");
    setRows(castRows<HouseAccountBalanceRow>(data));
    setLoading(false);
  }, [outletId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { rows, loading, reload };
}

export async function upsertHouseAccount(
  id: string | null,
  name: string,
  creditLimitPaisa: number,
  billingDay: number,
  customerId?: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("upsert_house_account", {
    p_id: id,
    p_name: name,
    p_credit_limit_paisa: creditLimitPaisa,
    p_billing_day: billingDay,
    p_customer_id: customerId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function setHouseAccountActive(accountId: string, active: boolean) {
  const supabase = createClient();
  const { error } = await supabase.rpc("set_house_account_active", {
    p_id: accountId,
    p_active: active,
  });
  if (error) throw new Error(error.message);
}

export async function recordHouseAccountPayment(
  accountId: string,
  amountPaisa: number,
  method: PaymentMethod,
  note?: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_house_account_payment", {
    p_account_id: accountId,
    p_amount_paisa: amountPaisa,
    p_method: method,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** One account's charge + payment history, newest first — the
 * statement Part 21 §5's spec calls for. Reads the two tables directly
 * (RLS-scoped through house_accounts, same join `read_house_account_*`
 * already uses) rather than a dedicated RPC, matching this codebase's
 * existing convention: reads go straight through Supabase, only writes
 * go through an RPC. */
export function useHouseAccountStatement(accountId: string | null) {
  const [charges, setCharges] = useState<HouseAccountCharge[]>([]);
  const [payments, setPayments] = useState<HouseAccountPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!accountId) {
      setCharges([]);
      setPayments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const [chargesRes, paymentsRes] = await Promise.all([
      supabase.from("house_account_charges").select("*").eq("account_id", accountId).order("created_at", { ascending: false }),
      supabase.from("house_account_payments").select("*").eq("account_id", accountId).order("created_at", { ascending: false }),
    ]);
    setCharges(castRows<HouseAccountCharge>(chargesRes.data));
    setPayments(castRows<HouseAccountPayment>(paymentsRes.data));
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { charges, payments, loading, reload };
}
