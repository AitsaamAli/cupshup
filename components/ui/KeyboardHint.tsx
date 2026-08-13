/**
 * Small monospace shortcut badge — the signature element (MASTER-DESIGN-
 * PROMPT: "keyboard-first order entry," the one place this app is allowed
 * to be memorable). Renders next to any actionable Terminal-density
 * element: `/` on search, `F2` on settle, `1-9` on result rows.
 */
export function KeyboardHint({ keys, className = "" }: { keys: string; className?: string }) {
  return (
    <kbd
      className={`inline-flex min-w-5 items-center justify-center rounded-sm border border-line bg-canvas px-1 font-mono text-[10px] font-medium text-ink-500 ${className}`}
    >
      {keys}
    </kbd>
  );
}
