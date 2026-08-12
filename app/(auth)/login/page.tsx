"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { defaultRouteForRole, type StaffRole } from "@/lib/auth";

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
      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: "magiclink",
        email: body.email,
        token_hash: body.tokenHash,
      });
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
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-6 text-white">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Cup Shup</h1>

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
    return <p className="text-neutral-400">Loading staff…</p>;
  }
  if (error) {
    return <p className="text-red-400">{error}</p>;
  }
  if (staffList.length === 0) {
    return <p className="text-neutral-400">No active staff found for this outlet.</p>;
  }

  return (
    <div className="grid w-full max-w-md grid-cols-2 gap-4">
      {staffList.map((person) => (
        <button
          key={person.id}
          onClick={() => onSelect(person)}
          className="flex flex-col items-center justify-center rounded-2xl border border-neutral-700 bg-neutral-900 px-4 py-6 text-center transition hover:border-neutral-500 active:scale-95"
        >
          <span className="text-lg font-medium">{person.name}</span>
          <span className="mt-1 text-sm text-neutral-400">{ROLE_LABEL[person.role]}</span>
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
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="flex w-full max-w-xs flex-col items-center">
      <button onClick={onBack} className="mb-4 self-start text-sm text-neutral-400 hover:text-white">
        ← Not {person.name}?
      </button>

      <p className="mb-4 text-lg font-medium">{person.name}</p>

      {/* PIN dots — never render the actual digits on screen */}
      <div className="mb-4 flex gap-3" aria-label="PIN entered">
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border border-neutral-500 ${
              i < pin.length ? "bg-white" : "bg-transparent"
            }`}
          />
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {digits.map((d, i) =>
          d === "" ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              disabled={submitting}
              onClick={() => (d === "⌫" ? onBackspace() : onDigit(d))}
              className="flex h-16 w-16 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-xl transition hover:border-neutral-500 active:scale-95 disabled:opacity-50"
            >
              {d}
            </button>
          )
        )}
      </div>

      <button
        onClick={onSubmit}
        disabled={pin.length < 4 || submitting}
        className="mt-6 w-full rounded-xl bg-white py-3 font-medium text-neutral-950 transition disabled:opacity-40"
      >
        {submitting ? "Checking…" : "Enter"}
      </button>
    </div>
  );
}
