import type { Metadata } from "next";
import { Inter, Noto_Nastaliq_Urdu } from "next/font/google";
import "./globals.css";
import { ShortcutsProvider } from "@/lib/shortcuts";
import { ShortcutsOverlay } from "@/components/ui/ShortcutsOverlay";
import { ToastProvider } from "@/components/ui/Toast";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { CommandPalette } from "@/components/ui/CommandPalette";

// Inter, not a decorative serif — POS screens are ~80% numbers, and Inter
// ships real tabular figures (`font-variant-numeric: tabular-nums`, applied
// globally in globals.css to every `[data-numeric]`/`.tabular-nums` element).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Urdu locale support (kitchen/KDS staff) — MASTER-DESIGN-PROMPT §7. Full
// next-intl routing/RTL wiring is scoped OUT of this pass (see
// docs/design-system.md's "deferred" note); the font is loaded now so any
// [lang="ur"] subtree already renders correctly the moment translated
// strings land.
const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  variable: "--font-urdu",
  subsets: ["arabic"],
  weight: ["400", "700"],
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
    <html lang="en" className={`${inter.variable} ${notoNastaliqUrdu.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegistration />
        <ShortcutsProvider>
          <ToastProvider>
            {children}
            <ShortcutsOverlay />
            <CommandPalette />
          </ToastProvider>
        </ShortcutsProvider>
      </body>
    </html>
  );
}
