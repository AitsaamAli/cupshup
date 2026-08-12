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

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_OPEN_CLOSE_DAY = new Set(["owner", "manager", "supervisor"]);

/**
 * Business Day & Shifts — Part 13. The day-open/day-closed enforcement
 * itself isn't in this UI at all — place_order() (Part 09) already
 * blocks orders at the database level regardless of what this screen
 * shows. This screen is where a manager opens/closes the day and each
 * cashier opens/closes their own drawer.
 */
export default function BusinessDayPage() {
  const { staff } = useStaffSession("manage");
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

  if (loading) return <p className="p-8 text-neutral-400">Loading…</p>;

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <h1 className="mb-6 text-xl font-semibold">Business Day &amp; Shifts</h1>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {!day || day.status !== "open" ? (
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
          <p className="text-neutral-400">
            No business day is open yet. Ask a manager or supervisor to open it.
          </p>
        )
      ) : (
        <>
          <section className="mb-6 rounded-xl border border-neutral-800 p-4">
            <p className="text-sm text-neutral-400">
              Business day: <span className="text-white">{day.business_date}</span> — status:{" "}
              <span className="text-emerald-400">{day.status}</span>
            </p>
          </section>

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

          <h2 className="mb-3 mt-6 font-medium">Shifts</h2>
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
        <ClosingReport snapshot={day.closing_snapshot} />
      )}
    </main>
  );
}

function OpenDayForm({ onOpen }: { onOpen: (floatPaisa: number) => Promise<void> }) {
  const [floatRupees, setFloatRupees] = useState("0");
  const [saving, setSaving] = useState(false);

  return (
    <section className="rounded-xl border border-neutral-800 p-4">
      <h2 className="mb-3 font-medium">Open Business Day</h2>
      <div className="flex items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Opening float (Rs)</span>
          <input
            type="number"
            step="0.01"
            value={floatRupees}
            onChange={(e) => setFloatRupees(e.target.value)}
            className="input w-40"
          />
        </label>
        <button
          onClick={async () => {
            setSaving(true);
            await onOpen(rupeesToPaisa(Number(floatRupees) || 0));
            setSaving(false);
          }}
          disabled={saving}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
        >
          {saving ? "Opening…" : "Open day"}
        </button>
      </div>
    </section>
  );
}

function OpenShiftForm({ onOpen }: { onOpen: (floatPaisa: number) => Promise<void> }) {
  const [floatRupees, setFloatRupees] = useState("0");
  const [saving, setSaving] = useState(false);

  return (
    <section className="mb-6 rounded-xl border border-neutral-800 p-4">
      <h2 className="mb-3 font-medium">Open my shift</h2>
      <div className="flex items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Opening float (Rs)</span>
          <input
            type="number"
            step="0.01"
            value={floatRupees}
            onChange={(e) => setFloatRupees(e.target.value)}
            className="input w-40"
          />
        </label>
        <button
          onClick={async () => {
            setSaving(true);
            await onOpen(rupeesToPaisa(Number(floatRupees) || 0));
            setSaving(false);
          }}
          disabled={saving}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
        >
          {saving ? "Opening…" : "Open my shift"}
        </button>
      </div>
    </section>
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
    <li className="rounded-xl border border-neutral-800 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">
          {cashierName} {isMine && <span className="text-xs text-neutral-500">(you)</span>}
        </p>
        <span className={shift.closed_at ? "text-neutral-500" : "text-emerald-400"}>
          {shift.closed_at ? "closed" : "open"}
        </span>
      </div>
      <p className="mb-2 text-sm text-neutral-400">
        Float: {formatPaisa(shift.opening_float_paisa as Paisa)}
        {shift.closed_at && (
          <>
            {" "}
            — Expected: {formatPaisa((shift.expected_cash_paisa ?? 0) as Paisa)} — Counted:{" "}
            {formatPaisa((shift.counted_cash_paisa ?? 0) as Paisa)} — Variance:{" "}
            <span className={(shift.variance_paisa ?? 0) < 0 ? "text-red-400" : "text-neutral-300"}>
              {formatPaisa((shift.variance_paisa ?? 0) as Paisa)}
            </span>
          </>
        )}
      </p>

      {canOperate && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Cash movement</span>
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as CashMovementType)}
              className="input"
            >
              <option value="drop">Drop (to safe)</option>
              <option value="pickup">Pickup</option>
              <option value="paid_out">Paid out</option>
              <option value="paid_in">Paid in</option>
              <option value="float_in">Float top-up</option>
            </select>
          </label>
          <input
            type="number"
            step="0.01"
            placeholder="Rs"
            value={movementAmount}
            onChange={(e) => setMovementAmount(e.target.value)}
            className="input w-24"
          />
          <button onClick={doMovement} disabled={busy} className="rounded-lg bg-neutral-800 px-3 py-2 text-xs">
            Record
          </button>

          <span className="mx-2 text-neutral-700">|</span>

          <input
            type="number"
            step="0.01"
            placeholder="Counted cash (Rs)"
            value={countedRupees}
            onChange={(e) => setCountedRupees(e.target.value)}
            className="input w-36"
          />
          <button
            onClick={doClose}
            disabled={busy || !countedRupees}
            className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-neutral-950"
          >
            Close shift
          </button>
        </div>
      )}
    </li>
  );
}

function CloseDayForm({ onClose }: { onClose: (countedPaisa: number) => Promise<void> }) {
  const [countedRupees, setCountedRupees] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <section className="rounded-xl border border-red-500/40 p-4">
      <h2 className="mb-1 font-medium">Close Business Day</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Locks the day permanently — no more orders, no reopening. Any still-open shifts are closed
        with this counted amount.
      </p>
      <div className="flex items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Total counted cash (Rs)</span>
          <input
            type="number"
            step="0.01"
            value={countedRupees}
            onChange={(e) => setCountedRupees(e.target.value)}
            className="input w-40"
          />
        </label>
        <button
          onClick={async () => {
            setSaving(true);
            await onClose(rupeesToPaisa(Number(countedRupees) || 0));
            setSaving(false);
          }}
          disabled={saving || !countedRupees}
          className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Closing…" : "Close day"}
        </button>
      </div>
    </section>
  );
}

function ClosingReport({ snapshot }: { snapshot: ClosingSnapshot }) {
  if (!snapshot) return null;
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
  ];

  return (
    <section className="mt-6 rounded-xl border border-neutral-800 p-4">
      <h2 className="mb-3 font-medium">Closing Report</h2>
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-t border-neutral-800">
              <td className="py-1.5 pr-4 text-neutral-400">{label}</td>
              <td className={`py-1.5 text-right ${label === "Variance" && value < 0 ? "text-red-400" : ""}`}>
                {label === "Orders settled" ? value : formatPaisa(value as Paisa)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
