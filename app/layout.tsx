import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ShortcutsProvider } from "@/lib/shortcuts";
import { ShortcutsOverlay } from "@/components/ui/ShortcutsOverlay";
import { ToastProvider } from "@/components/ui/Toast";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

// Part 15: Inter, not a decorative serif. POS screens are ~80% numbers —
// Inter ships real tabular figures (via `font-variant-numeric: tabular-nums`,
// applied per-element in Money.tsx and DataTable.tsx, not globally, so
// running body text keeps its normal proportional spacing).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cup Shup POS",
  description: "Cup Shup — Johar Town, Lahore",
  // Part 20: installable as a PWA (Add to Home Screen / Install App) —
  // an installed app opens straight into itself, no browser chrome/URL
  // bar, and survives a browser crash/restart independently of whatever
  // tabs were open. manifest.json + sw.js together are what makes a
  // terminal's browser offer the install prompt at all.
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegistration />
        <ShortcutsProvider>
          <ToastProvider>
            {children}
            <ShortcutsOverlay />
          </ToastProvider>
        </ShortcutsProvider>
      </body>
    </html>
  );
}
