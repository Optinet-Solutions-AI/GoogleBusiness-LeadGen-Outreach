"use client";

/**
 * EmailAccountsActions.tsx — "Connect Bluehost" CTA + modal opener.
 *
 * Inputs:  none
 * Outputs: opens ConnectMailboxModal; modal refreshes server data on close
 * Used by: app/(dashboard)/email-accounts/page.tsx
 */

import { useState } from "react";
import { Plus } from "lucide-react";
import { ConnectMailboxModal } from "./ConnectMailboxModal";
import { Button } from "@/components/ui/Button";

export function EmailAccountsActions() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus />
        Connect mailbox
      </Button>
      {open && <ConnectMailboxModal onClose={() => setOpen(false)} />}
    </>
  );
}
