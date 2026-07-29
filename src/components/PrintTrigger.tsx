"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

// Opens the browser print dialog (→ "Save as PDF") for the brief page.
export default function PrintTrigger({ auto = true }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    // Let fonts/layout settle before opening the dialog.
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [auto]);

  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
    >
      <Printer className="size-4" /> Save as PDF
    </button>
  );
}
