"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { printOrQueue } from "@/lib/print-queue";
import { isPrintAgentAvailable, type PrintJobKind } from "@/lib/print-agent-client";
import { BrowserPrintFallback } from "./browser-print-fallback";
import type { PrintDoc } from "@/lib/print-templates";

/**
 * The one print button every screen in this app uses — settlement
 * (receipt), KDS (kitchen ticket), day-close (report). Always tries the
 * local print agent first (no dialog, drawer kick, real paper cut); if
 * it's unreachable, drops straight to the browser fallback rather than
 * a doomed round trip through the agent first. If the agent IS up but
 * the actual print fails partway (paper out, printer powered off
 * mid-job), the job goes into the local retry queue
 * (lib/print-queue.ts) instead — "printer fail ho to order phir bhi
 * save ho": nothing here can fail an order, because by the time this
 * button exists the order/settlement/ticket it prints was already
 * committed.
 */
export function PrintButton({
  kind,
  doc,
  getDoc,
  label = "Print",
  drawer = false,
  meta,
}: {
  kind: PrintJobKind;
  /** Static content — fine for a kitchen ticket or a day report, which
   * don't change between the moment the button renders and the moment
   * it's clicked. */
  doc?: PrintDoc;
  /** Built fresh at click time instead — the receipt print button uses
   * this to call record_invoice_print() exactly once per real click
   * (never once per render), so the resulting "REPRINT #N" marker is
   * always accurate. Takes priority over `doc` when both are given. */
  getDoc?: () => Promise<PrintDoc>;
  label?: string;
  drawer?: boolean;
  /** Routing info for the agent beyond the doc itself — e.g. `{ station }`
   * for a kitchen ticket, see print-agent/config.json. */
  meta?: Record<string, unknown>;
}) {
  const { showToast } = useToast();
  const [printing, setPrinting] = useState(false);
  const [fallbackDoc, setFallbackDoc] = useState<PrintDoc | null>(null);

  async function handlePrint() {
    setPrinting(true);
    try {
      const resolvedDoc = getDoc ? await getDoc() : doc;
      if (!resolvedDoc) return;

      const agentUp = await isPrintAgentAvailable();
      if (!agentUp) {
        setFallbackDoc(resolvedDoc);
        return;
      }
      const { printed } = await printOrQueue(kind, resolvedDoc, { drawer, meta });
      showToast(printed ? "Printed." : "Print failed — queued for retry.", printed ? "success" : "error");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div>
      <Button variant="secondary" onClick={handlePrint} disabled={printing}>
        {printing ? "Printing…" : label}
      </Button>
      {fallbackDoc && <BrowserPrintFallback doc={fallbackDoc} onClose={() => setFallbackDoc(null)} />}
    </div>
  );
}
