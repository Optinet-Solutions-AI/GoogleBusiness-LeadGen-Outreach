"use client";

/**
 * EmailCampaignControls.tsx — send controls for an email campaign:
 *   1) choose the sender mailbox, 2) fire a test email to yourself (immediate,
 *   pre-flight), 3) Launch the real send (pending members within today's cap).
 *
 * Inputs:  campaignId + the connected active mailboxes (passed from the server page)
 * Outputs: POST /api/campaigns/[id]/test-send + /launch (both take { senderEmail })
 * Used by: app/(dashboard)/campaigns/[id]/page.tsx (email campaigns only).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

interface Mailbox {
  email: string;
  from_name: string | null;
}

export function EmailCampaignControls({
  campaignId,
  mailboxes,
}: {
  campaignId: string;
  mailboxes: Mailbox[];
}) {
  const router = useRouter();
  const [senderEmail, setSenderEmail] = useState(mailboxes[0]?.email ?? "");
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [launching, setLaunching] = useState(false);

  const hasMailbox = mailboxes.length > 0;

  async function sendTest() {
    if (!testTo.trim()) {
      toast.warning("Enter an email to send the test to.");
      return;
    }
    setTesting(true);
    const res = await fetchJson<{ sent: boolean; noMailbox?: boolean; via?: string }>(
      `/api/campaigns/${campaignId}/test-send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim(), senderEmail: senderEmail || undefined }),
      },
    );
    setTesting(false);
    if (!res.success) {
      toast.error(res.error, { title: "Test failed" });
      return;
    }
    if (res.data.noMailbox) {
      toast.warning("No active mailbox — connect one on Email accounts.");
      return;
    }
    toast.success(`Test sent to ${testTo.trim()}${res.data.via ? ` via ${res.data.via}` : ""}.`);
  }

  async function launch() {
    setLaunching(true);
    const res = await fetchJson<{ sent: number; held: number; skipped: number }>(
      `/api/campaigns/${campaignId}/launch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderEmail: senderEmail || undefined }),
      },
    );
    setLaunching(false);
    if (!res.success) {
      toast.error(res.error, { title: "Launch failed" });
      return;
    }
    const { sent, held } = res.data;
    toast.success(
      sent > 0
        ? `Sent ${sent}${held ? ` · ${held} held for the cap` : ""}.`
        : held
          ? "Nothing sent — daily cap reached."
          : "Nothing pending to send.",
    );
    router.refresh();
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-ink-subtle" strokeWidth={1.75} />
        <p className="eyebrow text-ink-muted">Email sending</p>
      </div>

      {!hasMailbox ? (
        <p className="text-[12.5px] text-ink-muted">
          No mailbox connected. Connect one on{" "}
          <a href="/email-accounts" className="underline underline-offset-2 hover:text-ink">
            Email accounts
          </a>{" "}
          to send.
        </p>
      ) : (
        <>
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">
              Sender
            </span>
            <select
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              className="w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none"
            >
              {mailboxes.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.from_name ? `${m.from_name} <${m.email}>` : m.email}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <label className="flex-1 min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">
                Send a test to
              </span>
              <input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@example.com"
                className="w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none"
              />
            </label>
            <Button variant="secondary" onClick={sendTest} loading={testing}>
              Send test
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-rule">
            <p className="text-[11px] text-ink-muted">Sends pending members within today&apos;s cap.</p>
            <Button variant="primary" onClick={launch} loading={launching}>
              {!launching && <Send strokeWidth={2} />} Launch send
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
