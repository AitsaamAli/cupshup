"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { StaffSession } from "@/lib/auth";
import { useMyAttendance, clockIn, clockOut, formatElapsed } from "@/lib/time-clock";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { KeyboardHint } from "./KeyboardHint";

/**
 * The one page chrome every screen mounts inside — MASTER-DESIGN-PROMPT
 * "AppShell layout." Portal mode gets a left sidebar + breadcrumbs;
 * Terminal mode gets a single thin top bar and nothing else, so the rest
 * of the screen stays working space. Both share the same header pieces
 * (wordmark, day/shift status, clock, language toggle, user chip).
 */
export function AppShell({
  density,
  nav,
  crumbs,
  staff,
  dayStatus,
  onLock,
  children,
}: {
  density: "portal" | "terminal";
  /** Portal-only: left sidebar links. Ignored in terminal density. */
  nav?: { label: string; href: string }[];
  /** Portal-only breadcrumb trail. */
  crumbs?: Crumb[];
  staff?: StaffSession | null;
  dayStatus?: "open" | "closed" | null;
  onLock?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header staff={staff} dayStatus={dayStatus} onLock={onLock} compact={density === "terminal"} />
      {density === "portal" ? (
        <div className="flex flex-1">
          {nav && nav.length > 0 && <Sidebar nav={nav} />}
          <div className="flex flex-1 flex-col">
            {crumbs && crumbs.length > 0 && (
              <div className="border-b border-line px-4 py-2">
                <Breadcrumbs items={crumbs} />
              </div>
            )}
            <main className="flex-1">{children}</main>
          </div>
        </div>
      ) : (
        <main className="flex-1">{children}</main>
      )}
    </div>
  );
}

function Header({
  staff,
  dayStatus,
  onLock,
  compact,
}: {
  staff?: StaffSession | null;
  dayStatus?: "open" | "closed" | null;
  onLock?: () => void;
  compact: boolean;
}) {
  const [lang, setLang] = useState<"en" | "ur">("en");

  return (
    <header
      className={`flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 ${
        compact ? "min-h-12" : "min-h-14"
      }`}
    >
      <div className="flex items-center gap-3">
        <Link href="/" className="text-portal-base font-semibold tracking-tight text-ink-900">
          Cup Shup
        </Link>
        {dayStatus && (
          <span
            className={`rounded-sm px-1.5 py-0.5 text-portal-2xs font-medium uppercase tracking-wide ${
              dayStatus === "open" ? "bg-brand-50 text-brand-700" : "bg-canvas text-ink-500"
            }`}
          >
            {dayStatus}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-1 text-portal-2xs text-ink-500 sm:flex">
          <KeyboardHint keys="⌘K" /> search
        </span>
        <Clock />
        <button
          onClick={() => setLang((l) => (l === "en" ? "ur" : "en"))}
          className="rounded-sm border border-line px-1.5 py-0.5 text-portal-2xs font-medium text-ink-500 hover:text-ink-900"
          aria-label="Toggle language"
        >
          {lang === "en" ? "EN" : "UR"}
        </button>
        {staff && <TimeClockControl staffId={staff.id} />}
        {staff && (
          <button
            onClick={onLock}
            className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-portal-xs text-ink-700 hover:bg-canvas"
          >
            <span className="font-medium">{staff.name}</span>
            <span className="text-ink-500">· {staff.role}</span>
          </button>
        )}
      </div>
    </header>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  // Renders nothing until mounted — avoids a server/client time mismatch.
  if (!now) return <span className="w-16" />;
  return (
    <span className="tabular-nums text-portal-xs text-ink-500">
      {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

/**
 * Clock in/out — Patch 2 (restaurant-system-master-prompt.md §6, staff
 * time clock). Mounted in AppShell's header, so it's available on every
 * authenticated screen without needing its own page. Live elapsed-time
 * display uses the same "render nothing until mounted" guard as Clock()
 * above, for the same reason (server/client time mismatch).
 */
function TimeClockControl({ staffId }: { staffId: string }) {
  const { open, reload } = useMyAttendance(staffId);
  const [now, setNow] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (open) {
        await clockOut(0);
      } else {
        await clockIn();
      }
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!now) return <span className="w-20" />;

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={error ?? undefined}
      className={`rounded-sm border px-1.5 py-0.5 text-portal-2xs font-medium ${
        open ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line text-ink-500 hover:text-ink-900"
      }`}
    >
      {open ? `Clocked in — ${formatElapsed(open.clock_in, now)}` : "Clock in"}
    </button>
  );
}

function Sidebar({ nav }: { nav: { label: string; href: string }[] }) {
  return (
    <nav className="hidden w-48 shrink-0 border-r border-line bg-surface py-3 md:block">
      <ul className="flex flex-col gap-0.5 px-2">
        {nav.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-md px-3 py-2 text-portal-sm text-ink-700 hover:bg-canvas hover:text-ink-900"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
