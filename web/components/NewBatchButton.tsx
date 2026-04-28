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
        className="bg-brand text-white px-4 py-2 rounded-full text-[12px] font-semibold uppercase tracking-wider flex items-center gap-2 hover:opacity-90 transition-opacity"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        New batch
      </button>
      {open && <NewBatchModal onClose={() => setOpen(false)} />}
    </>
  );
}
