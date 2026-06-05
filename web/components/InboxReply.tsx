"use client";

/**
 * InboxReply.tsx — reply composer at the bottom of an Inbox thread.
 *
 * Inputs:  { leadId, mailboxes, defaultSender } from the thread page
 * Outputs: POST /api/leads/[id]/reply { body, senderEmail } → toast + refresh
 * Used by: app/(dashboard)/inbox/[id]/page.tsx (when the lead has an email).
 *
 * Sends a real reply through the chosen mailbox; on success the new outbound
 * bubble appears via router.refresh().
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

interface Mailbox {
  email: string;
  from_name: string | null;
}

export function InboxReply({
  leadId,
  mailboxes,
  defaultSender,
}: {
  leadId: string;
  mailboxes: Mailbox[];
  defaultSender?: string | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [sender, setSender] = useState(defaultSender || mailboxes[0]?.email || "");
  const [sending, setSending] = useState(false);

  if (mailboxes.length === 0) {
    return (
      <p className="text-[11px] text-ink-subtle text-center mt-6">
        Connect a mailbox on{" "}
        <a href="/email-accounts" className="underline underline-offset-2 hover:text-ink">
          Email accounts
        </a>{" "}
        to reply from here.
      </p>
    );
  }

  async function send() {
    if (!body.trim()) {
      toast.warning("Write a reply first.");
      return;
    }
    setSending(true);
    const res = await fetchJson<{ sent: boolean; via?: string }>(`/api/leads/${leadId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: body.trim(), senderEmail: sender || undefined }),
    });
    setSending(false);
    if (!res.success) {
      toast.error(res.error, { title: "Reply failed" });
      return;
    }
    toast.success(`Reply sent${res.data.via ? ` from ${res.data.via}` : ""}.`);
    setBody("");
    router.refresh();
  }

  return (
    <div className="card p-3 mt-5 space-y-2 sticky bottom-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        rows={3}
        placeholder="Write a reply…  (⌘/Ctrl + Enter to send)"
        className="w-full px-3 py-2 text-[13px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none resize-y"
      />
      <div className="flex items-center justify-between gap-2">
        {mailboxes.length > 1 ? (
          <select
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            aria-label="Send from"
            className="h-8 px-2 text-[12px] text-ink-muted border border-rule rounded-lg bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none max-w-[60%] truncate"
          >
            {mailboxes.map((m) => (
              <option key={m.email} value={m.email}>
                {m.from_name ? `${m.from_name} <${m.email}>` : m.email}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] text-ink-subtle truncate">from {sender}</span>
        )}
        <Button variant="primary" size="sm" onClick={send} loading={sending}>
          {!sending && <Send strokeWidth={2} />} Send reply
        </Button>
      </div>
    </div>
  );
}
