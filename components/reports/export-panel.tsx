"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  downloadCsv,
  toCsv,
  fetchOrdersForExport,
  fetchPaymentsForExport,
  fetchExpensesForExport,
  fetchStockMovementsForExport,
  ORDER_EXPORT_COLUMNS,
  PAYMENT_EXPORT_COLUMNS,
  EXPENSE_EXPORT_COLUMNS,
  STOCK_MOVEMENT_EXPORT_COLUMNS,
  TAX_SUMMARY_EXPORT_COLUMNS,
} from "@/lib/export";
import { fetchTaxSummary } from "@/lib/reports";

/**
 * CSV export buttons — Part 18 §5, "accountant ke liye lazmi". Each
 * button pulls raw rows for the currently selected date range and
 * downloads them directly — no server round trip beyond the query
 * itself, nothing staged or emailed.
 */
export function ExportPanel({ outletId, from, to }: { outletId: string; from: string; to: string }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        disabled={busy !== null}
        onClick={() =>
          run("orders", async () => {
            const rows = await fetchOrdersForExport(outletId, from, to);
            downloadCsv(`orders_${from}_${to}.csv`, toCsv(rows, ORDER_EXPORT_COLUMNS));
          })
        }
      >
        {busy === "orders" ? "Exporting…" : "Orders CSV"}
      </Button>
      <Button
        variant="secondary"
        disabled={busy !== null}
        onClick={() =>
          run("payments", async () => {
            const rows = await fetchPaymentsForExport(outletId, from, to);
            downloadCsv(`payments_${from}_${to}.csv`, toCsv(rows, PAYMENT_EXPORT_COLUMNS));
          })
        }
      >
        {busy === "payments" ? "Exporting…" : "Payments CSV"}
      </Button>
      <Button
        variant="secondary"
        disabled={busy !== null}
        onClick={() =>
          run("expenses", async () => {
            const rows = await fetchExpensesForExport(outletId, from, to);
            downloadCsv(`expenses_${from}_${to}.csv`, toCsv(rows, EXPENSE_EXPORT_COLUMNS));
          })
        }
      >
        {busy === "expenses" ? "Exporting…" : "Expenses CSV"}
      </Button>
      <Button
        variant="secondary"
        disabled={busy !== null}
        onClick={() =>
          run("stock", async () => {
            const rows = await fetchStockMovementsForExport(outletId, from, to);
            downloadCsv(`stock_movements_${from}_${to}.csv`, toCsv(rows, STOCK_MOVEMENT_EXPORT_COLUMNS));
          })
        }
      >
        {busy === "stock" ? "Exporting…" : "Stock movements CSV"}
      </Button>
      <Button
        variant="secondary"
        disabled={busy !== null}
        onClick={() =>
          run("tax", async () => {
            const rows = await fetchTaxSummary(outletId, from, to);
            downloadCsv(`pra_tax_summary_${from}_${to}.csv`, toCsv(rows, TAX_SUMMARY_EXPORT_COLUMNS));
          })
        }
      >
        {busy === "tax" ? "Exporting…" : "PRA tax summary CSV"}
      </Button>
    </div>
  );
}
