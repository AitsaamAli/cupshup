"use client";

import { useShortcutsOverlay } from "@/lib/shortcuts";
import { Modal } from "./Modal";
import { KeyboardHint } from "./KeyboardHint";

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
      <ul className="space-y-2 text-portal-sm">
        {[...shortcuts.values()].map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-4">
            <span className="text-ink-700">{s.description}</span>
            <KeyboardHint keys={s.key} />
          </li>
        ))}
        {shortcuts.size === 0 && <p className="text-ink-500">No shortcuts on this screen.</p>}
      </ul>
    </Modal>
  );
}
