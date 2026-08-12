"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export interface ShortcutDef {
  key: string; // e.g. "n", "/", a single KeyboardEvent.key value
  description: string;
  handler: (e: KeyboardEvent) => void;
}

interface ShortcutsContextValue {
  register: (id: string, def: ShortcutDef) => void;
  unregister: (id: string) => void;
  shortcuts: Map<string, ShortcutDef>;
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

/**
 * Keyboard-shortcut registry — Part 15's signature element ("keyboard-
 * first order entry — mouse ke baghair poora order lag jaye"). Wrap the
 * app once with `<ShortcutsProvider>`; any screen registers its own
 * shortcuts with `useShortcut()` for as long as it's mounted. Pressing
 * "?" (outside a text field) toggles an overlay listing whatever
 * shortcuts are currently registered — always accurate, since it reads
 * the live registry rather than a hand-maintained list per screen.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<Map<string, ShortcutDef>>(new Map());
  const [overlayOpen, setOverlayOpen] = useState(false);

  const register = useCallback((id: string, def: ShortcutDef) => {
    setShortcuts((prev) => new Map(prev).set(id, def));
  }, []);

  const unregister = useCallback((id: string) => {
    setShortcuts((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

      if (e.key === "?" && !isTyping) {
        e.preventDefault();
        setOverlayOpen((open) => !open);
        return;
      }
      if (e.key === "Escape" && overlayOpen) {
        setOverlayOpen(false);
        return;
      }
      if (isTyping) return;

      for (const def of shortcuts.values()) {
        if (def.key === e.key) {
          e.preventDefault();
          def.handler(e);
          return;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, overlayOpen]);

  return (
    <ShortcutsContext.Provider value={{ register, unregister, shortcuts, overlayOpen, setOverlayOpen }}>
      {children}
    </ShortcutsContext.Provider>
  );
}

/**
 * Registers a keyboard shortcut for as long as the calling component
 * stays mounted, and lists it in the "?" overlay automatically. `id`
 * should be stable and unique per screen (e.g. a fixed string) — it's
 * what lets the registry replace a screen's own shortcut on re-render
 * instead of accumulating duplicates.
 */
export function useShortcut(id: string, key: string, description: string, handler: (e: KeyboardEvent) => void) {
  const ctx = useContext(ShortcutsContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.register(id, { key, description, handler });
    return () => ctx.unregister(id);
    // `handler` is deliberately excluded: re-registering on every render
    // (because an inline closure is a new reference each time) would
    // thrash the registry map for no benefit — id/key/description
    // changing is what actually means "this is a different shortcut."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key, description, ctx]);
}

export function useShortcutsOverlay(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error("useShortcutsOverlay() must be used inside <ShortcutsProvider>");
  return ctx;
}
