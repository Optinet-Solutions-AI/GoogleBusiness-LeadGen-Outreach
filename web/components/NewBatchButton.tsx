"use client";

/**
 * NewBatchButton.tsx — top-right primary action on the Batches page.
 * Toggles the NewBatchModal in place (no route change).
 */

import { useState } from "react";
import { Plus } from "lucide-react";
import { NewBatchModal } from "./NewBatchModal";
import { Button } from "@/components/ui/Button";

export function NewBatchButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="dark" className="group" data-tour="new-batch" onClick={() => setOpen(true)}>
        <Plus className="transition-transform group-hover:rotate-90" strokeWidth={2.25} />
        New batch
      </Button>
      {open && <NewBatchModal onClose={() => setOpen(false)} />}
    </>
  );
}
