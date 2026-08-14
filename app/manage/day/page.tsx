"use client";

import { useEffect, useState } from "react";
import { useStaffSession } from "@/lib/auth";
import {
  useBusinessDay,
  openBusinessDay,
  closeBusinessDay,
  openShift,
  closeShift,
  recordCashMovement,
  type Shift,
  type CashMovementType,
  type ClosingSnapshot,
} from "@/lib/business-day";
import { createClient } from "@/lib/supabase/client";
import { formatPaisa, rupeesToPaisa, type Paisa } from "@/lib/money";
import { PrintButton } from "@/components/print/print-button";
import { buildDayReportDoc } from "@/lib/print-templates";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/StatusBadge";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_OPEN_CLOSE_DAY = new Set(["owner", "manager", "supervisor"]);

const PORTAL_NAV = [
  { label: "Dashboard", href: "/reports/dashboard" },
  { label: "Master P&L", href: "/reports/pl" },
  { label: "Menu", href: "/manage/menu" },
  { label: "Inventory", href: "/manage/inventory" },
  { label: "Purchases", href: "/manage/purchases" },
  { label: "Expenses", href: "/manage/expenses" },
  { label: "Business day", href: "/manage/day" },
  { label: "House accounts", href: "/manage/house-accounts" },
];

/**
 * Business Day & Shifts — Part 13. The day-open/day-closed enforcement
 * itself isn't in this UI at all — place_order() (Part 09) already
 * blocks orders at the database level regardless of what this screen
 * shows. This screen is where a manager opens/closes the day and each
 * cashier opens/closes their own drawer.
 */
export default function BusinessDayPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day, shifts, loading, reload } = useBusinessDay(OUTLET_ID);
  const [cashierNames, setCashierNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (shifts.length === 0) return;
    const supabase = createClient();
    supabase
      .from("staff")
      .select("id, name")
      .in("id", shifts.map((s) => s.cashier_id))
      .then(({ data }) => {
        const map: Record<string, string> = {};
        (data as { id: string; name: string }[] | null)?.forEach((s) => (map[s.id] = s.name));
        setCashierNames(map);
      });
  }, [shifts]);

  const canOpenCloseDay = !!staff && CAN_OPEN_CLOSE_DAY.has(staff.role);
  const myOpenShift = shifts.find((s) => s.cashier_id === staff?.id && !s.closed_at) ?? null;

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Business day" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <h1 className="mb-4 text-portal-xl font-semibold text-ink-900">Business Day &amp; Shifts</h1>
        {error && <p className="mb-4 text-portal-sm text-danger">{error}</p>}

        {loading ? (
          <p className="text-portal-sm text-ink-500">Loading…</p>
        ) : !day || day.status !== "open" ? (
          canOpenCloseDay ? (
            <OpenDayForm
              onOpen={async (floatPaisa) => {
                try {
                  await openBusinessDay(OUTLET_ID, floatPaisa);
                  reload();
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
          ) : (
            <p className="text-portal-sm text-ink-500">
              No business day is open yet. Ask a manager or supervisor to open it.
            </p>
          )
        ) : (
          <>
            <Card className="mb-6 p-4">
              <p className="text-portal-sm text-ink-700">
                Business day: <span className="font-medium text-ink-900">{day.business_date}</span> — status:{" "}
                <StatusBadge status="ready" label={day.status} />
              </p>
            </Card>

            {!myOpenShift && staff && (
              <OpenShiftForm
                onOpen={async (floatPaisa) => {
                  try {
                    await openShift(floatPaisa);
                    reload();
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              />
            )}

            <h2 className="mb-3 mt-6 text-portal-sm font-semibold text-ink-900">Shifts</h2>
            <ul className="mb-6 space-y-3">
              {shifts.map((shift) => (
                <ShiftRow
                  key={shift.id}
                  shift={shift}
                  cashierName={cashierNames[shift.cashier_id] ?? shift.cashier_id}
                  isMine={shift.cashier_id === staff?.id}
                  canManage={canOpenCloseDay}
                  onChanged={reload}
                  onError={setError}
                />
              ))}
            </ul>

            {canOpenCloseDay && (
              <CloseDayForm
                onClose={async (countedPaisa) => {
                  try {
                    await closeBusinessDay(day.id, countedPaisa);
                    reload();
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              />
            )}
          </>
        )}

        {day?.status === "closed" && day.closing_snapshot && (
          <ClosingReport snapshot={day.closing_snapshot} businessDate={day.business_date} />
        )}
      </div>
    </AppShell>
  );
}

function OpenDayForm({ onOpen }: { onOpen: (floatPaisa: number) => Promise<void> }) {
  const [floatRupees, setFloatRupees] = useState("0");
  const [saving, setSaving] = useState(false);

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Open Business Day</h2>
      <div className="flex items-end gap-3">
        <Field label="Opening float (Rs)" htmlFor="open-day-float">
          <Input
            id="open-day-float"
            type="number"
            step="0.01"
            value={floatRupees}
            onChange={(e) => setFloatRupees(e.target.value)}
            className="w-40"
          />
        </Field>
        <Button
          variant="primary"
          onClick={async () => {
            setSaving(true);
            await onOpen(rupeesToPaisa(Number(floatRupees) || 0));
            setSaving(false);
          }}
          disabled={saving}
        >
          {saving ? "Opening…" : "Open day"}
        </Button>
      </div>
    </Card>
  );
}

function OpenShiftForm({ onOpen }: { onOpen: (floatPaisa: number) => Promise<void> }) {
  const [floatRupees, setFloatRupees] = useState("0");
  const [saving, setSaving] = useState(false);

  return (
    <Card className="mb-6 p-4">
      <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Open my shift</h2>
      <div className="flex items-end gap-3">
        <Field label="Opening float (Rs)" htmlFor="open-shift-float">
          <Input
            id="open-shift-float"
            type="number"
            step="0.01"
            value={floatRupees}
            onChange={(e) => setFloatRupees(e.target.value)}
            className="w-40"
          />
        </Field>
        <Button
          variant="primary"
          onClick={async () => {
            setSaving(true);
            await onOpen(rupeesToPaisa(Number(floatRupees) || 0));
            setSaving(false);
          }}
          disabled={saving}
        >
          {saving ? "Opening…" : "Open my shift"}
        </Button>
      </div>
    </Card>
  );
}

function ShiftRow({
  shift,
  cashierName,
  isMine,
  canManage,
  onChanged,
  onError,
}: {
  shift: Shift;
  cashierName: string;
  isMine: boolean;
  canManage: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [countedRupees, setCountedRupees] = useState("");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementType, setMovementType] = useState<CashMovementType>("drop");
  const [busy, setBusy] = useState(false);

  const canOperate = (isMine || canManage) && !shift.closed_at;

  async function doClose() {
    setBusy(true);
    try {
      await closeShift(shift.id, rupeesToPaisa(Number(countedRupees) || 0));
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doMovement() {
    const amount = rupeesToPaisa(Number(movementAmount) || 0);
    if (amount <= 0) {
      onError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    try {
      await recordCashMovement(shift.id, movementType, amount);
      setMovementAmount("");
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-portal-sm font-medium text-ink-900">
          {cashierName} {isMine && <span className="text-portal-xs text-ink-500">(you)</span>}
        </p>
        <StatusBadge status={shift.closed_at ? "neutral" : "ready"} label={shift.closed_at ? "Closed" : "Open"} />
      </div>
      <p className="mb-2 text-portal-sm text-ink-500">
        Float: {formatPaisa(shift.opening_float_paisa as Paisa)}
        {shift.closed_at && (
          <>
            {" "}
            — Expected: {formatPaisa((shift.expected_cash_paisa ?? 0) as Paisa)} — Counted:{" "}
            {formatPaisa((shift.counted_cash_paisa ?? 0) as Paisa)} — Variance:{" "}
            <span className={(shift.variance_paisa ?? 0) < 0 ? "text-danger" : "text-ink-700"}>
              {formatPaisa((shift.variance_paisa ?? 0) as Paisa)}
            </span>
          </>
        )}
      </p>

      {canOperate && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Cash movement" htmlFor={`shift-movement-${shift.id}`}>
            <Select
              id={`shift-movement-${shift.id}`}
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as CashMovementType)}
            >
              <option value="drop">Drop (to safe)</option>
              <option value="pickup">Pickup</option>
              <option value="paid_out">Paid out</option>
              <option value="paid_in">Paid in</option>
              <option value="float_in">Float top-up</option>
            </Select>
          </Field>
          <Input
            type="number"
            step="0.01"
            placeholder="Rs"
            value={movementAmount}
            onChange={(e) => setMovementAmount(e.target.value)}
            className="w-24"
            aria-label="Movement amount"
          />
          <Button variant="secondary" onClick={doMovement} disabled={busy}>
            Record
          </Button>

          <span className="mx-2 text-ink-300">|</span>

          <Input
            type="number"
            step="0.01"
            placeholder="Counted cash (Rs)"
            value={countedRupees}
            onChange={(e) => setCountedRupees(e.target.value)}
            className="w-36"
            aria-label="Counted cash"
          />
          <Button variant="primary" onClick={doClose} disabled={busy || !countedRupees}>
            Close shift
          </Button>
        </div>
      )}
    </li>
  );
}

function CloseDayForm({ onClose }: { onClose: (countedPaisa: number) => Promise<void> }) {
  const [countedRupees, setCountedRupees] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <Card className="border-danger/40 p-4">
      <h2 className="mb-1 text-portal-sm font-semibold text-ink-900">Close Business Day</h2>
      <p className="mb-3 text-portal-xs text-ink-500">
        Locks the day permanently — no more orders, no reopening. Any still-open shifts are closed
        with this counted amount.
      </p>
      <div className="flex items-end gap-3">
        <Field label="Total counted cash (Rs)" htmlFor="close-day-counted">
          <Input
            id="close-day-counted"
            type="number"
            step="0.01"
            value={countedRupees}
            onChange={(e) => setCountedRupees(e.target.value)}
            className="w-40"
          />
        </Field>
        <Button
          variant="danger"
          onClick={async () => {
            setSaving(true);
            await onClose(rupeesToPaisa(Number(countedRupees) || 0));
            setSaving(false);
          }}
          disabled={saving || !countedRupees}
        >
          {saving ? "Closing…" : "Close day"}
        </Button>
      </div>
    </Card>
  );
}

function ClosingReport({ snapshot, businessDate }: { snapshot: ClosingSnapshot; businessDate: string }) {
  if (!snapshot) return null;

  async function buildReport() {
    const supabase = createClient();
    const { data } = await supabase.from("outlets").select("name").eq("id", OUTLET_ID).single();
    const outletName = (data as unknown as { name: string } | null)?.name ?? "Cup Shup";
    return buildDayReportDoc({ outletName, businessDate, snapshot });
  }
  const rows: [string, number][] = [
    ["Orders settled", snapshot.orders],
    ["Revenue", snapshot.revenue_paisa],
    ["Tax collected", snapshot.tax_paisa],
    ["COGS", snapshot.cogs_paisa],
    ["Gross profit (revenue − COGS)", snapshot.gross_profit_paisa],
    ["Expenses", snapshot.expenses_paisa],
    ["Net profit", snapshot.net_profit_paisa],
    ["Opening float", snapshot.opening_float_paisa],
    ["Cash sales", snapshot.cash_sales_paisa],
    ["Cash drops", snapshot.cash_drops_paisa],
    ["Expected cash", snapshot.expected_cash_paisa],
    ["Counted cash", snapshot.counted_cash_paisa],
    ["Variance", snapshot.variance_paisa],
    // 0043_settled_void_reconciliation.sql — surfaced separately from
    // variance on purpose: this is a "go review these" flag, not part of
    // the cash-math itself. See the type's own comment in business-day.ts.
    ["Voided after settlement", snapshot.voided_after_settle_cash_paisa ?? 0],
  ];

  return (
    <Card className="mt-6 p-4">
      <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Closing Report</h2>
      <table className="w-full text-left text-portal-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-1.5 pr-4 text-ink-500">{label}</td>
              <td
                className={`py-1.5 text-right tabular-nums ${
                  (label === "Variance" && value < 0) || (label === "Voided after settlement" && value > 0)
                    ? "text-danger"
                    : "text-ink-900"
                }`}
              >
                {label === "Orders settled" ? value : formatPaisa(value as Paisa)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3">
        <PrintButton kind="report" getDoc={buildReport} label="Print report" />
      </div>
    </Card>
  );
}
