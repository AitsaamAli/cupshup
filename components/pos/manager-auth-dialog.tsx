"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { StaffRole } from "@/lib/auth";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const APPROVER_ROLES: StaffRole[] = ["owner", "manager", "supervisor"];

interface ApprovedStaff {
  id: string;
  name: string;
  role: StaffRole;
}

/**
 * "Manager approval" — used to authorise a discount or a void when the
 * staff member currently working the register isn't allowed to do it
 * alone (Part 10, Section 4: "Void ke liye Manager ka PIN lazmi").
 *
 * This runs the EXACT same PIN → magic-link → verifyOtp exchange as the
 * login screen (Part 07) — there's no lightweight "just check the PIN"
 * shortcut, because void_order()/settle_order()'s discount check both
 * read the CURRENT session's role via current_staff(). Approving here
 * genuinely swaps the browser's active session to the approving
 * manager, the same way picking a name on /login does. Once the
 * approved action completes, the manager's session simply stays active
 * until the next idle-timeout or explicit staff switch — consistent
 * with how every other screen in this app already treats a PIN entry.
 */
export function ManagerAuthDialog({
  title,
  onApproved,
  onCancel,
}: {
  title: string;
  onApproved: (staff: ApprovedStaff) => void;
  onCancel: () => void;
}) {
  const [staffList, setStaffList] = useState<ApprovedStaff[] | null>(null);
  const [selected, setSelected] = useState<ApprovedStaff | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.rpc("list_active_staff", { p_outlet_id: OUTLET_ID }).then(({ data }) => {
      const all = (data as ApprovedStaff[]) ?? [];
      setStaffList(all.filter((s) => APPROVER_ROLES.includes(s.role)));
    });
  }, []);

  async function submit() {
    if (!selected || pin.length < 4) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: selected.id, pin }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Invalid PIN");
        setPin("");
        return;
      }

      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: "magiclink",
        email: body.email,
        token_hash: body.tokenHash,
      });
      if (verifyError) {
        setError("Could not verify. Try again.");
        setPin("");
        return;
      }

      onApproved(body.staff as ApprovedStaff);
    } catch {
      setError("Network error — try again.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xs rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-white">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-medium">{title}</h3>
          <button onClick={onCancel} className="text-neutral-500">
            ✕
          </button>
        </div>

        {!selected ? (
          <div className="space-y-2">
            {staffList === null && <p className="text-sm text-neutral-400">Loading…</p>}
            {staffList?.length === 0 && (
              <p className="text-sm text-neutral-400">No manager/owner/supervisor available.</p>
            )}
            {staffList?.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-left text-sm hover:bg-neutral-700"
              >
                {s.name} <span className="text-neutral-500">— {s.role}</span>
              </button>
            ))}
          </div>
        ) : (
          <div>
            <p className="mb-2 text-sm text-neutral-400">{selected.name}&apos;s PIN</p>
            <div className="mb-3 flex gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <span
                  key={i}
                  className={`h-3 w-3 rounded-full border border-neutral-500 ${
                    i < pin.length ? "bg-white" : "bg-transparent"
                  }`}
                />
              ))}
            </div>
            {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) =>
                d === "" ? (
                  <div key={i} />
                ) : (
                  <button
                    key={i}
                    disabled={submitting}
                    onClick={() =>
                      d === "⌫"
                        ? setPin((p) => p.slice(0, -1))
                        : pin.length < 6 && setPin((p) => p + d)
                    }
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-lg disabled:opacity-50"
                  >
                    {d}
                  </button>
                )
              )}
            </div>
            <button
              onClick={submit}
              disabled={pin.length < 4 || submitting}
              className="mt-3 w-full rounded-xl bg-white py-2 font-medium text-neutral-950 disabled:opacity-40"
            >
              {submitting ? "Checking…" : "Approve"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
