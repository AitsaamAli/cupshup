"use client";

import { Button } from "@/components/ui/Button";
import { PrintDocView } from "./print-doc-view";
import type { PrintDoc } from "@/lib/print-templates";

/**
 * The backup path (brief §2a) — shown only when the local print agent
 * isn't reachable at all. Deliberately plain, static-positioned markup
 * (no fixed overlay) so `.print-doc`'s `position: absolute` in
 * globals.css resolves against the page itself, not some wrapper's own
 * positioning context — this is a rare path, correctness at print time
 * matters far more here than an on-screen modal treatment.
 */
export function BrowserPrintFallback({ doc, onClose }: { doc: PrintDoc; onClose: () => void }) {
  return (
    <div className="my-4 rounded-md border border-warning/40 bg-warning/10 p-4">
      <p className="mb-3 text-sm text-amber-300">
        Print agent unavailable — using the browser&apos;s print dialog instead.
      </p>
      <div className="mb-3 max-h-80 overflow-y-auto rounded-md bg-white">
        <PrintDocView doc={doc} />
      </div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => window.print()}>
          Print
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
