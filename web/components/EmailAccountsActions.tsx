"use client";

/**
 * EmailAccountsActions.tsx — "Connect Bluehost" CTA + modal opener.
 *
 * Inputs:  none
 * Outputs: opens ConnectBluehostModal; modal refreshes server data on close
 * Used by: app/(dashboard)/email-accounts/page.tsx
 */

import { useState } from "react";
import { Plus } from "lucide-react";
import { ConnectBluehostModal } from "./ConnectBluehostModal";

export function EmailAccountsActions() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-action text-white text-sm font-semibold shadow-sm hover:bg-action/90"
      >
        <Plus className="h-4 w-4" />
        Connect Bluehost
      </button>
      {open && <ConnectBluehostModal onClose={() => setOpen(false)} />}
    </>
  );
}
