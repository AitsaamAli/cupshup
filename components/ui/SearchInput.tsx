"use client";

import { useEffect, useRef } from "react";
import { SearchIcon } from "./icons";

/**
 * A search box with a global keyboard shortcut to focus it — Part 15.
 * Defaults to "/" (the same convention as GitHub, Slack, Linear), shown
 * as a hint inside the box itself so staff learn it just by looking,
 * without needing the full "?" shortcuts overlay (lib/shortcuts.ts).
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  shortcutKey = "/",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  shortcutKey?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (e.key === shortcutKey && !isTyping) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcutKey]);

  return (
    <div className="relative">
      <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="input pl-9"
      />
      {!value && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-sm border border-line px-1.5 text-xs text-ink-500">
          {shortcutKey}
        </span>
      )}
    </div>
  );
}
