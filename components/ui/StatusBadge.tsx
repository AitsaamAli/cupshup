type Status = "void" | "waiting" | "ready" | "neutral";

const STATUS_CLASSES: Record<Status, string> = {
  // Fixed meanings, used nowhere else in the app for anything else:
  void: "bg-danger/10 text-danger",
  waiting: "bg-warning/10 text-warning",
  ready: "bg-brand-50 text-brand-700",
  neutral: "bg-canvas text-ink-500",
};

const STATUS_LABEL: Record<Status, string> = {
  void: "Void",
  waiting: "Waiting",
  ready: "Ready",
  neutral: "—",
};

/**
 * A small status pill with a fixed colour meaning — Part 15. Red always
 * means void/danger, amber always means waiting/needs attention, green
 * always means ready/success, everywhere in this app. Never repurpose
 * these colours for anything else, or staff stop trusting them at a
 * glance (the same principle Part 13's cash-variance alerts depend on).
 */
export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}>
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}
