"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { ManagerAuthDialog } from "@/components/pos/manager-auth-dialog";
import { voidOrder } from "@/lib/orders";
import type { StaffRole } from "@/lib/auth";

const APPROVER_ROLES = new Set(["owner", "manager", "supervisor"]);

const VOID_REASONS = [
  { code: "wrong_item", label: "Wrong item punched" },
  { code: "customer_cancel", label: "Customer cancelled" },
  { code: "kitchen_86", label: "Kitchen ran out" },
  { code: "quality", label: "Quality issue" },
  { code: "training", label: "Training" },
];

/**
 * F4 → this dialog — Part 16. void_order() itself checks the CURRENT
 * session's role, so if the cashier isn't already owner/manager/
 * supervisor, a manager has to approve first (same
 * ManagerAuthDialog/session-swap pattern as Part 10's settle screen).
 */
export function VoidOrderDialog({
  orderId,
  currentRole,
  onClose,
  onVoided,
}: {
  orderId: string;
  currentRole: StaffRole | undefined;
  onClose: () => void;
  onVoided: () => void;
}) {
  const [needsApproval, setNeedsApproval] = useState(!currentRole || !APPROVER_ROLES.has(currentRole));
  const [reason, setReason] = useState(VOID_REASONS[0].code);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmVoid() {
    setSubmitting(true);
    setError(null);
    try {
      await voidOrder(orderId, reason, { reasonNote: note || undefined });
      onVoided();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (needsApproval) {
    return (
      <ManagerAuthDialog
        title="Manager approval required to void"
        onCancel={onClose}
        onApproved={() => setNeedsApproval(false)}
      />
    );
  }

  return (
    <Modal title="Void order" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Reason" htmlFor="void-reason">
          <Select id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            {VOID_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)" htmlFor="void-note">
          <Input id="void-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p className="text-portal-sm text-danger">{error}</p>}
        <Button variant="danger" density="terminal" className="w-full" disabled={submitting} onClick={confirmVoid}>
          {submitting ? "Voiding…" : "Confirm void"}
        </Button>
      </div>
    </Modal>
  );
}
