"use client";

/**
 * A large, touch-friendly numeric keypad — Part 15. Used for PIN entry
 * (Part 07's login and manager-approval dialogs), quantity entry, and
 * cash-tendered entry — any place staff need to type digits fast without
 * a physical keyboard. Every key is well over the 44×44px minimum touch
 * target; digits use tabular-nums so the grid never reflows.
 *
 * This is a controlled component: it renders `value` and calls
 * `onChange`/`onBackspace` — it holds no state of its own.
 */
export function NumericKeypad({
  value,
  onDigit,
  onBackspace,
  maxLength = 6,
  disabled = false,
}: {
  value: string;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  maxLength?: number;
  disabled?: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Numeric keypad">
      {keys.map((key, i) =>
        key === "" ? (
          <div key={i} aria-hidden="true" />
        ) : (
          <button
            key={i}
            type="button"
            disabled={disabled}
            aria-label={key === "⌫" ? "Backspace" : `Digit ${key}`}
            onClick={() => (key === "⌫" ? onBackspace() : value.length < maxLength && onDigit(key))}
            className="flex h-14 w-14 items-center justify-center rounded-md border border-line bg-surface text-lg tabular-nums text-ink-900 transition-colors duration-[120ms] ease-out hover:bg-canvas disabled:opacity-50"
          >
            {key}
          </button>
        )
      )}
    </div>
  );
}

/** A row of dots showing how many digits have been entered, without
 * ever rendering the digits themselves — used for PIN entry. */
export function KeypadDots({ length, max = 6 }: { length: number; max?: number }) {
  return (
    <div className="flex gap-2" role="status" aria-label={`${length} of ${max} digits entered`}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`h-3 w-3 rounded-full border border-ink-500 ${i < length ? "bg-brand-600 border-brand-600" : "bg-transparent"}`}
        />
      ))}
    </div>
  );
}
