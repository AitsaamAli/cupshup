"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { PrintDoc } from "@/lib/print-templates";

/**
 * Renders a PrintDoc as HTML — the browser-print fallback's own view
 * (see globals.css's `.print-doc` rules for the actual 80mm layout).
 * The QR code has to be rendered as a real image here (CSS can't draw
 * one); the print agent's ESC/POS path doesn't need this at all — a
 * thermal printer's own built-in QR command handles it directly from
 * the payload string.
 */
export function PrintDocView({ doc }: { doc: PrintDoc }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!doc.qrPayload) {
      setQrDataUrl(null);
      return;
    }
    let mounted = true;
    QRCode.toDataURL(doc.qrPayload, { margin: 0, width: 160 })
      .then((url) => {
        if (mounted) setQrDataUrl(url);
      })
      .catch(() => {
        if (mounted) setQrDataUrl(null);
      });
    return () => {
      mounted = false;
    };
  }, [doc.qrPayload]);

  return (
    <div className="print-doc">
      {doc.rows.map((row, i) => {
        if ("divider" in row) return <hr key={i} className="print-doc-divider" />;
        if ("blank" in row) return <div key={i} className="print-doc-blank" />;
        const classes = [
          "print-doc-row",
          row.align === "center" ? "print-doc-center" : "",
          row.bold ? "print-doc-bold" : "",
          row.size === "large" ? "print-doc-large" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={i} className={classes}>
            <span>{row.left}</span>
            {row.right !== undefined && <span>{row.right}</span>}
          </div>
        );
      })}
      {qrDataUrl && (
        <div className="print-doc-qr">
          {/* Print output, not a normal page image — next/image's optimisation
              pipeline (remote loader, lazy-load, srcset) has no benefit on a
              locally-generated data: URI that only ever needs to be printed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="PRA verification QR code" width={160} height={160} />
        </div>
      )}
    </div>
  );
}
