"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { StaffRole } from "@/lib/auth";
import { Modal } from "@/components/ui/Modal";
import { NumericKeypad, KeypadDots } from "@/components/ui/NumericKeypad";
import { Button } from "@/components/ui/Button";

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
 *
 * Rebuilt on Part 15's shared components (Modal, NumericKeypad,
 * KeypadDots, Button) — was hand-rolled duplicate markup before.
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
    <Modal title={title} onClose={onCancel}>
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
              className="min-h-11 w-full rounded-md bg-neutral-800 px-3 py-2 text-left text-sm hover:bg-neutral-700"
            >
              {s.name} <span className="text-neutral-500">— {s.role}</span>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <p className="mb-2 text-sm text-neutral-400">{selected.name}&apos;s PIN</p>
          <div className="mb-3">
            <KeypadDots length={pin.length} />
          </div>
          {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
          <NumericKeypad
            value={pin}
            disabled={submitting}
            onDigit={(d) => setPin((p) => p + d)}
            onBackspace={() => setPin((p) => p.slice(0, -1))}
          />
          <Button
            variant="primary"
            onClick={submit}
            disabled={pin.length < 4 || submitting}
            className="mt-3 w-full"
          >
            {submitting ? "Checking…" : "Approve"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
