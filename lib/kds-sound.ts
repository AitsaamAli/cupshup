"use client";

import { useEffect, useRef } from "react";

const MUTE_KEY = "kds-muted";

export function isKdsMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}

export function setKdsMuted(muted: boolean) {
  window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}

/**
 * A short two-tone beep via the Web Audio API — no audio file to bundle,
 * host, or fail to load. Deliberately not a fire-and-forget <audio> tag:
 * browsers block autoplay without a prior user gesture, and Web Audio
 * lets the first tap anywhere on the KDS screen unlock it, same as
 * every kiosk app does.
 */
export function playNewOrderBeep() {
  if (isKdsMuted()) return;
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.15;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Web Audio unsupported or blocked — never let a beep failure break
    // the actual screen.
  }
}

/**
 * Beeps once per order id that's new since the last render — not once
 * per render, and not for tickets already on the board when the screen
 * first loads (a KDS reopened mid-shift with five active tickets
 * shouldn't beep five times).
 */
export function useNewTicketSound(orderIds: string[]) {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(orderIds);
      return;
    }
    const hasNew = orderIds.some((id) => !seen.current!.has(id));
    if (hasNew) playNewOrderBeep();
    seen.current = new Set(orderIds);
  }, [orderIds]);
}
