"use client";

import { useShortcutsOverlay } from "@/lib/shortcuts";
import { Modal } from "./Modal";

/**
 * The "?" overlay — Part 15. Mount this once near the root (alongside
 * `<ShortcutsProvider>`); it renders nothing until "?" is pressed, then
 * lists exactly whatever shortcuts the current screen has registered
 * via `useShortcut()`.
 */
export function ShortcutsOverlay() {
  const { overlayOpen, setOverlayOpen, shortcuts } = useShortcutsOverlay();
  if (!overlayOpen) return null;

  return (
    <Modal title="Keyboard shortcuts" onClose={() => setOverlayOpen(false)}>
      <ul className="space-y-2 text-sm">
        {[...shortcuts.values()].map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-4">
            <span className="text-neutral-300">{s.description}</span>
            <kbd className="rounded-sm border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs">{s.key}</kbd>
          </li>
        ))}
        {shortcuts.size === 0 && <p className="text-neutral-500">No shortcuts on this screen.</p>}
      </ul>
    </Modal>
  );
}
