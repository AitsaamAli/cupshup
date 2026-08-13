"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { defaultRouteForRole, type StaffRole } from "@/lib/auth";
import { buildVerifyOtpArgs } from "@/lib/auth-otp";
import { NumericKeypad, KeypadDots } from "@/components/ui/NumericKeypad";
import { Button } from "@/components/ui/Button";

/**
 * Staff PIN login. Two steps, both touch-friendly for a shared tablet:
 *
 *   1. Tap your name from the staff grid (list_active_staff() — names
 *      and roles only, safe to show on a fully logged-out device).
 *   2. Enter your 4–6 digit PIN on a big on-screen numeric pad.
 *
 * The PIN is NEVER checked here. It's POSTed to app/api/auth/pin, which
 * verifies it server-side and — only on success — hands back a one-time
 * token this page exchanges for a real Supabase session belonging to
 * that specific staff member. See docs/auth-design.md for why.
 *
 * Nothing about a staff member's password is ever shown, stored client
 * side, or typed by staff at all — the PIN is the entire login surface.
 */

type StaffOption = { id: string; name: string; role: StaffRole };

// Single outlet for now — see docs/auth-design.md for the multi-outlet note.
const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;

const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  supervisor: "Supervisor",
  cashier: "Cashier",
  chef: "Chef",
  kitchen: "Kitchen",
  barista: "Barista",
};

export default function LoginPage() {
  const router = useRouter();
  const [staffList, setStaffList] = useState<StaffOption[] | null>(null);
  const [selected, setSelected] = useState<StaffOption | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .rpc("list_active_staff", { p_outlet_id: OUTLET_ID })
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError("Could not load staff list. Check your connection.");
          setStaffList([]);
          return;
        }
        setStaffList((data as StaffOption[]) ?? []);
      });
  }, []);

  function selectStaff(person: StaffOption) {
    setSelected(person);
    setPin("");
    setError(null);
  }

  function backToStaffGrid() {
    setSelected(null);
    setPin("");
    setError(null);
  }

  function pressDigit(digit: string) {
    if (pin.length >= 6) return;
    setError(null);
    setPin((p) => p + digit);
  }

  function backspace() {
    setError(null);
    setPin((p) => p.slice(0, -1));
  }

  async function submitPin() {
    if (!selected || pin.length < 4 || submitting) return;
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
        // Never reveal more than the server chose to say (e.g. lockout
        // status) — this is already the full, deliberately generic message.
        setError(body.error ?? "Invalid PIN");
        setPin("");
        return;
      }

      const supabase = createClient();
      // buildVerifyOtpArgs() — not inlined — so the exact argument
      // shape (token_hash + type, deliberately never email alongside
      // it) has its own permanent test. See that function's own
      // comment for why.
      const { error: verifyError } = await supabase.auth.verifyOtp(buildVerifyOtpArgs(body.tokenHash));
      if (verifyError) {
        setError("Could not start your session. Try again.");
        setPin("");
        return;
      }

      router.push(defaultRouteForRole(body.staff.role as StaffRole));
    } catch {
      setError("Network error — try again.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas p-6">
      <h1 className="mb-8 text-terminal-xl font-semibold tracking-tight text-ink-900">Cup Shup</h1>

      {!selected ? (
        <StaffGrid staffList={staffList} error={error} onSelect={selectStaff} />
      ) : (
        <PinPad
          person={selected}
          pin={pin}
          error={error}
          submitting={submitting}
          onDigit={pressDigit}
          onBackspace={backspace}
          onSubmit={submitPin}
          onBack={backToStaffGrid}
        />
      )}
    </main>
  );
}

function StaffGrid({
  staffList,
  error,
  onSelect,
}: {
  staffList: StaffOption[] | null;
  error: string | null;
  onSelect: (person: StaffOption) => void;
}) {
  if (staffList === null) {
    return <p className="text-portal-sm text-ink-500">Loading staff…</p>;
  }
  if (error) {
    return <p className="text-portal-sm text-danger">{error}</p>;
  }
  if (staffList.length === 0) {
    return <p className="text-portal-sm text-ink-500">No active staff found for this outlet.</p>;
  }

  return (
    <div className="grid w-full max-w-md grid-cols-2 gap-4">
      {staffList.map((person) => (
        <button
          key={person.id}
          onClick={() => onSelect(person)}
          className="flex flex-col items-center justify-center rounded-md border border-line bg-surface px-4 py-6 text-center transition-transform duration-[120ms] ease-out hover:border-brand-300 active:scale-95"
        >
          <span className="text-terminal-base font-medium text-ink-900">{person.name}</span>
          <span className="mt-1 text-portal-sm text-ink-500">{ROLE_LABEL[person.role]}</span>
        </button>
      ))}
    </div>
  );
}

function PinPad({
  person,
  pin,
  error,
  submitting,
  onDigit,
  onBackspace,
  onSubmit,
  onBack,
}: {
  person: StaffOption;
  pin: string;
  error: string | null;
  submitting: boolean;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  // The on-screen keypad is the primary input (touch-first, per the
  // design brief), but this screen also runs on a desktop browser during
  // development/testing — a physical keyboard should just work too,
  // rather than silently doing nothing.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (submitting) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        onDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        onBackspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onSubmit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submitting, onDigit, onBackspace, onSubmit]);

  return (
    <div className="flex w-full max-w-xs flex-col items-center">
      <button onClick={onBack} className="mb-4 self-start text-portal-sm text-ink-500 hover:text-ink-900">
        ← Not {person.name}?
      </button>

      <p className="mb-4 text-terminal-base font-medium text-ink-900">{person.name}</p>

      <div className="mb-4">
        <KeypadDots length={pin.length} />
      </div>

      {error && <p className="mb-3 text-portal-sm text-danger">{error}</p>}

      <NumericKeypad value={pin} disabled={submitting} onDigit={onDigit} onBackspace={onBackspace} />

      <Button
        variant="primary"
        density="terminal"
        onClick={onSubmit}
        disabled={pin.length < 4 || submitting}
        className="mt-6 w-full"
      >
        {submitting ? "Checking…" : "Enter"}
      </Button>
    </div>
  );
}
