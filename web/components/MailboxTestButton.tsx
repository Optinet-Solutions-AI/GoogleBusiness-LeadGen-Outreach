"use client";

/**
 * MailboxTestButton.tsx — per-mailbox "Send test" control on the Email accounts page.
 *
 * Inputs:  { sender } — the mailbox address to send through
 * Outputs: POST /api/email-accounts/test { email: sender, to } → toast on result
 * Used by: app/(dashboard)/email-accounts/page.tsx (active mailboxes only).
 *
 * Collapsed: a "Send test" ghost button. Open: an inline to-address input + Send,
 * so the operator can prove the mailbox actually delivers (real SMTP, not a no-op).
 */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

export function MailboxTestButton({ sender }: { sender: string }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const dest = to.trim();
    if (!dest) {
      toast.warning("Enter an email to send the test to.");
      return;
    }
    setSending(true);
    const res = await fetchJson<{ sent: boolean; via?: string }>("/api/email-accounts/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: sender, to: dest }),
    });
    setSending(false);
    if (!res.success) {
      toast.error(res.error, { title: "Test failed" });
      return;
    }
    toast.success(`Test sent to ${dest} from ${res.data.via ?? sender}. Check that inbox.`);
    setOpen(false);
    setTo("");
  }

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Send test
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="email"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
          if (e.key === "Escape") {
            setOpen(false);
            setTo("");
          }
        }}
        placeholder="you@example.com"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        className="h-8 w-44 px-2 text-[12px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none"
      />
      <Button variant="primary" onClick={send} loading={sending}>
        Send
      </Button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setTo("");
        }}
        className="text-[12px] text-ink-subtle hover:text-ink transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
