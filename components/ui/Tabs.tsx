"use client";

/** Simple, controlled tab strip — station tabs (KDS), date-range tabs, etc. */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  density = "portal",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  density?: "portal" | "terminal" | "kds";
}) {
  const sizeClass =
    density === "kds" ? "text-kds-sm px-4 py-2.5 min-h-16" : density === "terminal" ? "text-terminal-sm px-4 py-2 min-h-14" : "text-portal-sm px-3 py-1.5 min-h-11";

  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`${sizeClass} -mb-px flex items-center justify-center border-b-2 font-medium transition-colors duration-[120ms] ease-out ${
              active ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-900"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
