"use client";

/**
 * NewBatchButton.tsx — top-right primary action on the Batches page.
 * Toggles the NewBatchModal in place (no route change).
 */

import { useState } from "react";
import { Plus } from "lucide-react";
import { NewBatchModal } from "./NewBatchModal";

export function NewBatchButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-ink text-canvas px-4 py-2.5 rounded text-[12px] font-semibold tracking-wide flex items-center gap-2 hover:bg-ink/85 transition-colors group"
      >
        <Plus className="h-3.5 w-3.5 transition-transform group-hover:rotate-90" strokeWidth={2.25} />
        New batch
      </button>
      {open && <NewBatchModal onClose={() => setOpen(false)} />}
    </>
  );
}
