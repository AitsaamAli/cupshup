"use client";

import { STATIONS, type Station } from "@/lib/kds";

/**
 * Station picker — Part 17. Deliberately NOT the shared Button
 * component: KDS needs a bigger touch target than the rest of the app
 * (64x64px minimum per the brief, vs. 44px everywhere else — wet hands,
 * gloves, a screen mounted further away), so these are their own
 * larger-scale buttons rather than trying to bend Button's className.
 */
export function StationTabs({
  active,
  onChange,
}: {
  active: Station | null;
  onChange: (station: Station | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <StationTab label="All stations" selected={active === null} onClick={() => onChange(null)} />
      {STATIONS.map((s) => (
        <StationTab key={s.value} label={s.label} selected={active === s.value} onClick={() => onChange(s.value)} />
      ))}
    </div>
  );
}

function StationTab({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-16 rounded-md px-6 text-kds-sm font-semibold transition-colors duration-[120ms] ease-out ${
        selected ? "bg-brand-600 text-white" : "bg-surface text-ink-700 hover:bg-canvas"
      }`}
    >
      {label}
    </button>
  );
}
