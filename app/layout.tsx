import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ShortcutsProvider } from "@/lib/shortcuts";
import { ShortcutsOverlay } from "@/components/ui/ShortcutsOverlay";
import { ToastProvider } from "@/components/ui/Toast";

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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
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
