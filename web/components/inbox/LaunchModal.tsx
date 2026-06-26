"use client";

/**
 * LaunchModal.tsx — gated launch: send a test email first, then confirm or discard.
 *
 * Flow: enter a test address → Send test → "Sent successfully" →
 *   [All good, launch]  → POST /api/campaigns/[id]/launch → onLaunched()
 *   [Something's wrong] → close without launching.
 *
 * Used by: CampaignRowActions (list) + EmailCampaignControls (detail).
 */

import { useState } from "react";
import { X, Send, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

type Phase = "test" | "sent" | "launching";

export function LaunchModal({
  campaignId,
  campaignName,
  onClose,
  onLaunched,
}: {
  campaignId: string;
  campaignName?: string;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("test");
  const [to, setTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [sentTo, setSentTo] = useState("");

  async function sendTest() {
    if (!to.trim()) return toast.warning("Enter an email to send the test to.");
    setTesting(true);
    const res = await fetchJson<{ sent: boolean; noMailbox?: boolean; via?: string }>(
      `/api/campaigns/${campaignId}/test-send`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: to.trim() }) },
    );
    setTesting(false);
    if (!res.success) return toast.error(res.error, { title: "Test failed" });
    if (res.data.noMailbox) return toast.warning("No active mailbox — connect one on Email accounts.");
    setSentTo(to.trim());
    setPhase("sent");
  }

  async function doLaunch() {
    setPhase("launching");
    const res = await fetchJson<{ enrolled: number; skipped: number }>(
      `/api/campaigns/${campaignId}/launch`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
    );
    if (!res.success) {
      setPhase("sent");
      return toast.error(res.error, { title: "Launch failed" });
    }
    toast.success(
      res.data.enrolled > 0
        ? `Launched — ${res.data.enrolled} enrolled${res.data.skipped ? ` (${res.data.skipped} skipped)` : ""}.`
        : "Nothing to enroll — members already active, unverified, or no email.",
    );
    onLaunched();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-24" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-rule bg-canvas shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <p className="eyebrow text-ink-muted">
            {phase === "test" ? "Test before launch" : "Test sent"}
            {campaignName ? ` · ${campaignName}` : ""}
          </p>
          <button onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-surface-alt hover:text-ink">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {phase === "test" ? (
          <div className="space-y-3 p-4">
            <p className="text-[12.5px] text-ink-muted">
              Send yourself the real step-1 email (tokens filled, spintax + screenshot/link applied) so you can check
              it before anyone gets it. Nothing goes to leads until you confirm.
            </p>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") sendTest(); }}
              className="h-9 w-full rounded-lg border border-rule-strong px-3 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20"
            />
            <div className="flex justify-end">
              <Button variant="primary" onClick={sendTest} loading={testing}>
                {!testing && <Send strokeWidth={2} />} Send test
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <div className="flex items-start gap-2.5 rounded-lg bg-positive-soft border border-positive/30 px-3 py-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-positive" strokeWidth={2} />
              <p className="text-[12.5px] text-ink">
                Test sent to <span className="font-semibold">{sentTo}</span>. Check it looks right, then choose:
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button variant="primary" onClick={doLaunch} loading={phase === "launching"}>
                {phase === "launching" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 strokeWidth={2} />}
                All good — launch campaign
              </Button>
              <button
                onClick={onClose}
                disabled={phase === "launching"}
                className="rounded-lg border border-rule px-3 py-2 text-[12.5px] font-medium text-ink-muted hover:bg-surface-alt hover:text-ink disabled:opacity-50"
              >
                Something&apos;s wrong — discard
              </button>
              <button
                onClick={() => setPhase("test")}
                disabled={phase === "launching"}
                className="text-[11px] text-ink-subtle underline underline-offset-2 hover:text-ink disabled:opacity-50"
              >
                Send another test
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
