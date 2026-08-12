"use client";

import type { PrintDoc } from "./print-templates";

/**
 * The browser's side of the local print agent (print-agent/, a small
 * standalone Node service meant to run on the terminal itself — see
 * print-agent/README.md for setup). It's a plain local HTTP server
 * rather than anything routed through Supabase or the internet: a
 * cash-drawer kick or a paper cut has to happen in well under a
 * second, and it has to keep working even if the internet is down,
 * which rules out anything that leaves the LAN.
 */

const AGENT_URL = process.env.NEXT_PUBLIC_PRINT_AGENT_URL ?? "http://localhost:9100";

export class PrintAgentUnavailableError extends Error {}

/** Health check with a short timeout — used to decide whether to try
 * the agent at all before falling back to the browser's own print view
 * (components/print/*), rather than waiting out a long default fetch
 * timeout on every single print attempt. */
export async function isPrintAgentAvailable(timeoutMs = 800): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${AGENT_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export type PrintJobKind = "receipt" | "kitchen" | "report";

export interface PrintJobOptions {
  drawer?: boolean;
  /** Extra routing info the agent needs beyond the doc itself — right
   * now just `{ station }` for a kitchen ticket, so the agent knows
   * which physical station printer to use (print-agent/config.json).
   * Kept generic rather than a dedicated `station` parameter so a
   * future job type can add its own metadata without another signature
   * change here. */
  meta?: Record<string, unknown>;
}

/** Sends one already-built PrintDoc to the agent. Throws
 * PrintAgentUnavailableError on any failure — network error, agent not
 * running, or the agent itself reporting a printer fault — so the
 * caller can queue it for retry (lib/print-queue.ts) rather than lose
 * it. Never throws for "the order wasn't saved": by the time anything
 * calls this, settle_order()/place_order() has already committed. */
export async function sendToPrintAgent(kind: PrintJobKind, doc: PrintDoc, options: PrintJobOptions = {}): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${AGENT_URL}/print/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc, drawer: options.drawer ?? false, meta: options.meta ?? {} }),
    });
  } catch (err) {
    throw new PrintAgentUnavailableError((err as Error).message);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new PrintAgentUnavailableError(body.error ?? `Print agent returned ${res.status}`);
  }
}
