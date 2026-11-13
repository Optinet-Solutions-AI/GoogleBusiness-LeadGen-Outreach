/**
 * outreach/CallPreviewModal.tsx — "Call with AI" opens this first: what the AI agent will and won't know.
 *
 * Inputs:  one or more lead ids; GET /api/leads/:id/call/preview per lead
 * Outputs: on Queue, POST /api/leads/:id/call { greeting_name, test_phone? } per included lead. The number is
 *          editable: a changed number (e.g. your own, to test the agent) is dialled for that call only.
 * Used by: components/leads/ContactCard.tsx, components/LeadsTable.tsx (row + bulk)
 *
 * Voizo takes only the number and a first name; the rest of the conversation is one fixed script on the
 * Voizo campaign. This dialog says that plainly, so the operator checks the two things that ARE per lead.
 */
"use client";

import { useEffect, useState } from "react";
import { PhoneCall, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { cx } from "@/lib/cx";

interface CallPreview {
  leadId: string;
  businessName: string;
  canCall: boolean;
  block: string | null;
  needsNumber: boolean;
  phone: string | null;
  ownerName: string | null;
  greetingName: string | null;
  alreadyQueued: boolean;
  script: { campaignName: string | null; shadow: boolean | null };
  voizo: { configured: boolean; ready: boolean | null; remainingToday: number | null; dailyCap: number | null; windows: string | null; error: string | null };
  ourHours: string;
  queueAhead: number;
  attempts: { max: number; retryHours: number };
}

type Row = { id: string; preview: CallPreview | null; error: string | null; name: string; phone: string; include: boolean; result: null | "queued" | "failed" };

/** The typed number when it differs from the lead's (a test call), else null. */
function testPhoneOf(r: Row): string | null {
  const typed = r.phone.trim();
  if (!typed) return null;
  const digits = (s: string) => s.replace(/\D/g, "");
  return digits(typed) === digits(r.preview?.phone ?? "") ? null : typed;
}

const INPUT =
  "w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none";

async function mapLimit<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

export function CallPreviewModal({ leadIds, onClose, onDone }: { leadIds: string[]; onClose: () => void; onDone?: () => void }) {
  const single = leadIds.length === 1;
  const [rows, setRows] = useState<Row[]>(() => leadIds.map((id) => ({ id, preview: null, error: null, name: "", phone: "", include: false, result: null })));
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  useEffect(() => {
    let alive = true;
    mapLimit(leadIds, 4, async (id) => {
      const res = await fetchJson<CallPreview>(`/api/leads/${id}/call/preview`);
      if (!alive) return;
      if (!res.success) patch(id, { error: res.error });
      else patch(id, { preview: res.data, name: res.data.greetingName ?? "", phone: res.data.phone ?? "", include: res.data.canCall && !res.data.needsNumber });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !sending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  const loading = rows.some((r) => !r.preview && !r.error);
  const shared = rows.find((r) => r.preview)?.preview ?? null;
  const chosen = rows.filter((r) => r.include && r.preview?.canCall && r.phone.trim() !== "");

  async function queue() {
    if (!chosen.length || sending) return;
    setSending({ done: 0, total: chosen.length });
    let ok = 0;
    let lastMsg = "";
    for (const r of chosen) {
      const res = await fetchJson<{ message: string }>(`/api/leads/${r.id}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ greeting_name: r.name.trim() || null, test_phone: testPhoneOf(r) }),
      });
      if (res.success) {
        ok += 1;
        lastMsg = res.data.message;
        patch(r.id, { result: "queued" });
      } else {
        lastMsg = res.error;
        patch(r.id, { result: "failed", error: res.error });
      }
      setSending((s) => (s ? { ...s, done: s.done + 1 } : s));
    }
    setSending(null);
    if (single) (ok ? toast.success : toast.error)(lastMsg, { title: ok ? "AI call queued" : "AI call" });
    else (ok === chosen.length ? toast.success : toast.warning)(`${ok} of ${chosen.length} queued for an AI call.`);
    onDone?.();
    if (ok === chosen.length) onClose();
  }

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-end sm:items-center justify-center sm:p-4" onClick={() => !sending && onClose()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="AI call preview"
        className="bg-white w-full sm:max-w-[600px] max-h-[94vh] flex flex-col rounded-t-xl sm:rounded-xl border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-rule">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink truncate">
              {single ? `AI call to ${rows[0].preview?.businessName ?? "this lead"}` : `AI calls to ${leadIds.length} leads`}
            </h2>
            <p className="text-[12px] text-ink-muted">Check what the agent will know. Nothing is dialled until you press Queue.</p>
          </div>
          <button type="button" onClick={onClose} disabled={!!sending} aria-label="Close" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && <p className="text-[13px] text-ink-muted">Checking the AI caller…</p>}

          {/* Per lead: the only two things the agent gets */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted font-mono">What the agent gets for {single ? "this lead" : "each lead"}</p>
            {rows.map((r) => (
              <div key={r.id} className={cx("rounded-lg border px-3 py-2.5", r.result === "failed" ? "border-urgent/40" : "border-rule")}>
                {!single && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Include ${r.preview?.businessName ?? "lead"}`}
                      checked={r.include}
                      disabled={!r.preview?.canCall || !!sending}
                      onChange={(e) => patch(r.id, { include: e.target.checked })}
                    />
                    <span className="text-[13px] font-semibold text-ink truncate flex-1">{r.preview?.businessName ?? (r.error ? "Couldn't load" : "Loading…")}</span>
                    {r.result === "queued" && <span className="text-[11px] font-semibold text-positive">Queued</span>}
                  </div>
                )}
                {r.error && !r.preview && <p className="text-[12px] text-urgent">{r.error}</p>}
                {r.preview && !r.preview.canCall && (
                  <p className="text-[12px] text-ink"><span className="font-semibold text-urgent">Can&rsquo;t call: </span>{r.preview.block}</p>
                )}
                {r.preview?.canCall && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="block text-[11px] text-ink-muted mb-0.5">Number it dials</span>
                      <input
                        value={r.phone}
                        onChange={(e) => patch(r.id, { phone: e.target.value, include: single ? true : r.include || e.target.value.trim() !== "" })}
                        placeholder="+1 512 555 0123"
                        inputMode="tel"
                        maxLength={40}
                        className={cx(INPUT, "mono-num")}
                        disabled={!!sending}
                        aria-label="Number it dials"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[11px] text-ink-muted mb-0.5">Name it greets them by</span>
                      <input
                        value={r.name}
                        onChange={(e) => patch(r.id, { name: e.target.value })}
                        placeholder="No name (leave empty)"
                        maxLength={40}
                        className={INPUT}
                        disabled={!!sending}
                      />
                    </label>
                    {testPhoneOf(r) && (
                      <p className="sm:col-span-2 text-[11px] text-warning">
                        Test number: only this call goes to it{r.preview.phone ? ` (instead of ${r.preview.phone})` : ""}. The lead&rsquo;s saved number isn&rsquo;t changed; the call result is saved on this lead.
                      </p>
                    )}
                    {r.preview.needsNumber && !r.phone.trim() && (
                      <p className="sm:col-span-2 text-[11px] text-ink-muted">No phone on file. Type a number to call (e.g. yours, to test the agent).</p>
                    )}
                    <p className="sm:col-span-2 text-[11px] text-ink-subtle">
                      {r.preview.ownerName ? `Owner on file: ${r.preview.ownerName}. ` : "No owner name on file. "}
                      Use a first name only, or leave it empty and the agent won&rsquo;t use a name.
                      {r.result === "failed" && r.error ? ` ${r.error}` : ""}
                      {r.preview.alreadyQueued ? " Already in the call queue; saving updates the name." : ""}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {shared && (
            <>
              <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[12px] text-ink space-y-1">
                <p className="font-semibold">Everything else it says comes from one fixed script in Voizo.</p>
                <p>
                  The script is the same for every lead{shared.script.campaignName ? <> (Voizo campaign <span className="font-semibold">“{shared.script.campaignName}”</span>)</> : ""}.
                  The agent is <span className="font-semibold">not</span> told the business name, your offer, the demo site, their website or reviews.
                  Change the wording in that Voizo campaign if it needs to say something different.
                </p>
              </div>

              <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                <dt className="text-ink-muted">When</dt>
                <dd className="text-ink">
                  Within about 15 minutes during calling hours: {shared.ourHours}.
                  {shared.voizo.windows && <span className="block text-[11px] text-ink-subtle">Voizo&rsquo;s own calling hours: {shared.voizo.windows}.</span>}
                </dd>
                <dt className="text-ink-muted">Queue</dt>
                <dd className="text-ink">
                  One call at a time. {shared.queueAhead ? `${shared.queueAhead} lead${shared.queueAhead === 1 ? "" : "s"} waiting.` : "Nobody else waiting."}
                  {shared.voizo.remainingToday != null && ` ${shared.voizo.remainingToday} of ${shared.voizo.dailyCap ?? 100} calls left today.`}
                </dd>
                <dt className="text-ink-muted">No answer</dt>
                <dd className="text-ink">Tries up to {shared.attempts.max} times, {shared.attempts.retryHours} hours apart. Voicemail counts as no answer.</dd>
                <dt className="text-ink-muted">Afterwards</dt>
                <dd className="text-ink">Interested → the lead lands in the Inbox for you to follow up. Not interested or wrong number → never called again.</dd>
              </dl>
              {shared.voizo.error && <p className="text-[11px] text-warning">Couldn&rsquo;t reach Voizo just now ({shared.voizo.error}). The call still queues and goes out once Voizo answers.</p>}
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-rule flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-ink-muted">{sending ? `Queueing ${sending.done}/${sending.total}…` : "EU/UK leads are never called (GDPR)."}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={!!sending}>Cancel</Button>
            <Button onClick={queue} loading={!!sending} disabled={loading || !chosen.length || !!sending}>
              <PhoneCall strokeWidth={2} /> {single ? "Queue the call" : `Queue ${chosen.length} call${chosen.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
