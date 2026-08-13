"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "./icons";
import { KeyboardHint } from "./KeyboardHint";

export interface Command {
  id: string;
  label: string;
  group: string;
  /** Extra words this command should also match on, beyond its label. */
  keywords?: string;
  run: () => void;
}

const NAV_COMMANDS: Omit<Command, "run">[] = [
  { id: "nav-pos", label: "Go to POS", group: "Navigate" },
  { id: "nav-kds", label: "Go to Kitchen Display", group: "Navigate", keywords: "kds kitchen" },
  { id: "nav-dashboard", label: "Go to Dashboard", group: "Navigate", keywords: "reports" },
  { id: "nav-pl", label: "Go to Master P&L", group: "Navigate", keywords: "profit loss reports" },
  { id: "nav-menu", label: "Go to Menu", group: "Navigate", keywords: "manage items" },
  { id: "nav-inventory", label: "Go to Inventory", group: "Navigate", keywords: "manage stock" },
  { id: "nav-purchases", label: "Go to Purchases", group: "Navigate", keywords: "manage suppliers grn" },
  { id: "nav-expenses", label: "Go to Expenses", group: "Navigate", keywords: "manage" },
  { id: "nav-day", label: "Go to Business day", group: "Navigate", keywords: "manage shift cash" },
];

const NAV_ROUTES: Record<string, string> = {
  "nav-pos": "/pos",
  "nav-kds": "/kds",
  "nav-dashboard": "/reports/dashboard",
  "nav-pl": "/reports/pl",
  "nav-menu": "/manage/menu",
  "nav-inventory": "/manage/inventory",
  "nav-purchases": "/manage/purchases",
  "nav-expenses": "/manage/expenses",
  "nav-day": "/manage/day",
};

/**
 * Cmd/Ctrl+K command palette — the Linear benchmark item: "har kaam
 * yahan se". Mounted once near the app root (`app/layout.tsx`), so it's
 * reachable from every screen. Ships with navigation to every major
 * screen out of the box; a screen can register more commands later via
 * the same pattern `lib/shortcuts.tsx` already uses for keyboard hints,
 * without this component needing to know about POS/KDS/reports specifics.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(
    () => NAV_COMMANDS.map((c) => ({ ...c, run: () => router.push(NAV_ROUTES[c.id]) })),
    [router]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.keywords?.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function runActive() {
    const cmd = filtered[activeIndex];
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runActive();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center bg-black/40 pt-[15vh]" role="presentation" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg rounded-lg border border-line bg-surface shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <SearchIcon size={16} className="shrink-0 text-ink-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search…"
            aria-label="Command palette search"
            className="flex-1 bg-transparent text-portal-base text-ink-900 outline-none placeholder:text-ink-300"
          />
          <KeyboardHint keys="Esc" />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 && <li className="px-3 py-3 text-portal-sm text-ink-500">No matching command.</li>}
          {filtered.map((cmd, i) => (
            <li key={cmd.id}>
              <button
                role="option"
                aria-selected={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => {
                  setOpen(false);
                  cmd.run();
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-portal-sm ${
                  i === activeIndex ? "bg-brand-50 text-brand-700" : "text-ink-900"
                }`}
              >
                <span>{cmd.label}</span>
                <span className="text-portal-2xs text-ink-500">{cmd.group}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
