"use client";

import { useCallback, useEffect, useState } from "react";
import type { PrintDoc } from "./print-templates";
import { isPrintAgentAvailable, sendToPrintAgent, type PrintJobKind, type PrintJobOptions } from "./print-agent-client";

/**
 * A print job that failed and is waiting to be retried — "printer band
 * ho to saaf error, order phir bhi save" (the order is ALWAYS already
 * saved by the time anything here runs) "aur reprint queue mein aa
 * jaye". Held in localStorage, not the database: this is purely a
 * per-device "what does THIS terminal still need to physically print"
 * list, not a business record — the actual reprint audit trail
 * (invoice_prints, Part 18/19) is written the moment a print is
 * attempted, independent of whether the paper ever came out.
 */
export interface QueuedPrintJob {
  id: string;
  kind: PrintJobKind;
  doc: PrintDoc;
  drawer: boolean;
  meta?: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

const STORAGE_KEY = "cupshup-print-queue";

// ---- Pure list operations — testable without touching localStorage ----

export function withNewJob(jobs: QueuedPrintJob[], job: QueuedPrintJob): QueuedPrintJob[] {
  return [...jobs, job];
}

export function withoutJob(jobs: QueuedPrintJob[], id: string): QueuedPrintJob[] {
  return jobs.filter((j) => j.id !== id);
}

export function withFailedAttempt(jobs: QueuedPrintJob[], id: string, error: string): QueuedPrintJob[] {
  return jobs.map((j) => (j.id === id ? { ...j, attempts: j.attempts + 1, lastError: error } : j));
}

// ---- localStorage-backed persistence ----

function loadQueue(): QueuedPrintJob[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveQueue(jobs: QueuedPrintJob[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

/** Attempts one print, queueing it on failure instead of losing it.
 * This is the one function every print button in the app should call —
 * app/pos/settle, components/kds/ticket-card, app/manage/day all use
 * it the same way. */
export async function printOrQueue(
  kind: PrintJobKind,
  doc: PrintDoc,
  options: PrintJobOptions = {}
): Promise<{ printed: boolean }> {
  try {
    await sendToPrintAgent(kind, doc, options);
    return { printed: true };
  } catch (err) {
    const jobs = loadQueue();
    const job: QueuedPrintJob = {
      id: crypto.randomUUID(),
      kind,
      doc,
      drawer: options.drawer ?? false,
      meta: options.meta,
      createdAt: new Date().toISOString(),
      attempts: 1,
      lastError: (err as Error).message,
    };
    saveQueue(withNewJob(jobs, job));
    return { printed: false };
  }
}

/** The pending-prints indicator/retry panel's data source. Retries
 * every queued job once the agent's health check succeeds — same
 * "check on reconnect" shape as Part 17's KDS board and this part's own
 * PRA reconcile loop (lib/pra.ts), applied to a local device queue
 * instead of a database one. */
export function usePrintQueue() {
  const [jobs, setJobs] = useState<QueuedPrintJob[]>([]);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(() => setJobs(loadQueue()), []);

  const retryAll = useCallback(async () => {
    setRetrying(true);
    try {
      const available = await isPrintAgentAvailable();
      if (!available) return;
      let current = loadQueue();
      for (const job of current) {
        try {
          await sendToPrintAgent(job.kind, job.doc, { drawer: job.drawer, meta: job.meta });
          current = withoutJob(current, job.id);
          saveQueue(current);
        } catch (err) {
          current = withFailedAttempt(current, job.id, (err as Error).message);
          saveQueue(current);
        }
      }
      setJobs(current);
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    retryAll();
    const onOnline = () => retryAll();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { jobs, retrying, retryAll, refresh };
}
