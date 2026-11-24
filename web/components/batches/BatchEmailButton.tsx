"use client";
/**
 * batches/BatchEmailButton.tsx — "Email this batch" on the batch page: preview who gets an email (and who is
 * skipped and why), pick the email per offer, see a sample, then start (24 Nov 2026).
 *
 * Inputs:  the batch id; GET /api/batches/:id/email?eu=&choices= (the preview, free)
 * Outputs: POST /api/batches/:id/email { dailyLimit, followUps, includeEu, choices } → a batch email campaign
 * Used by: app/(dashboard)/batches/[id]/page.tsx
 *
 * Dumb client: who qualifies and which email each lead gets is decided in lib/campaigns/batch-email.ts. Nothing is
 * sent when it starts: the email scheduler sends at most the daily limit of first emails a day, Mon–Fri 9–17.
 * Defaults (operator decisions 24 Nov 2026): 10 a day, follow-ups off, EU / UK leads left out.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Mail, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

type Group = {
  offer: string;
  label: string;
  count: number;
  autoLabel: string;
  choices: { key: string; label: string }[];
  sample: { to: string; from: string; subject: string; body: string; emailLabel: string } | null;
};
type Plan = {
  batchName: string;
  total: number;
  eligible: number;
  toCheck: number;
  skipped: { reason: string; text: string; count: number }[];
  euCount: number;
  groups: Group[];
  senders: string[];
  timezone: string;
  running: string | null;
  formLeads: number;
};

const INPUT = "w-full px-3 py-2 text-[13px] border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none bg-white";

export function BatchEmailButton({ batchId }: { batchId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} title="Email the leads in this batch automatically, a few a day">
        <Mail className="h-4 w-4" /> Email this batch
      </Button>
      {open && <BatchEmailModal batchId={batchId} onClose={() => setOpen(false)} />}
    </>
  );
}

function BatchEmailModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeEu, setIncludeEu] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [dailyLimit, setDailyLimit] = useState(10);
  const [followUps, setFollowUps] = useState<0 | 1 | 2>(0);
  // Off by default when started by hand (review fix): the automatic start turns it on.
  const [contactForms, setContactForms] = useState(false);
  const [starting, setStarting] = useState(false);
  const [done, setDone] = useState<{ campaignId: string; enrolled: number; failed: number; days: number; firstAt: string | null } | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ eu: includeEu ? "1" : "0", choices: JSON.stringify(choices) });
    const r = await fetchJson<Plan>(`/api/batches/${batchId}/email?${q}`);
    if (r.success) {
      setPlan(r.data);
      setError(null);
    } else setError(r.error);
  }, [batchId, includeEu, choices]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !starting && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const days = plan ? Math.ceil(plan.eligible / Math.max(1, dailyLimit)) : 0;
  const canStart = !!plan && (plan.eligible > 0 || (contactForms && plan.formLeads > 0)) && !plan.running && plan.senders.length > 0 && dailyLimit >= 1 && dailyLimit <= 100 && !starting;

  async function start() {
    if (!plan || !canStart) return;
    const fu = followUps ? ` plus ${followUps} follow-up${followUps > 1 ? "s" : ""} each if they don't reply` : "";
    if (!window.confirm(`Start emailing ${plan.eligible} leads? These are real emails: about ${dailyLimit} a day for about ${days} working day${days === 1 ? "" : "s"}${fu}. You can pause it on the Campaigns page.`)) return;
    setStarting(true);
    const r = await fetchJson<{ campaignId: string; enrolled: number; failed: number; days: number; firstAt: string | null }>(`/api/batches/${batchId}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyLimit, followUps, includeEu, choices, contactForms }),
    });
    setStarting(false);
    if (!r.success) return void toast.error(r.error, { title: "Not started" });
    setDone(r.data);
    toast.success(`Started: ${r.data.enrolled} leads, about ${dailyLimit} a day.`);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-[2px] sm:p-4" onClick={() => !starting && onClose()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Email this batch"
        className="bg-white w-full sm:max-w-[720px] max-h-[94vh] flex flex-col rounded-t-xl sm:rounded-xl border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-rule">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink truncate">Email this batch{plan ? ` · ${plan.batchName}` : ""}</h2>
            <p className="text-[12px] text-ink-muted">
              Each lead gets the email Send email would pick for its offer. A few go out each weekday, 9:00 to 17:00 in their country&rsquo;s time.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={starting} aria-label="Close" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-[13px] text-ink">
          {error && <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px]">{error}</div>}
          {!plan && !error && <p className="text-ink-muted">Loading…</p>}

          {done ? (
            <div className="space-y-2">
              <p className="font-semibold text-positive">
                Started: {done.enrolled} leads{done.failed ? ` (${done.failed} couldn't be added)` : ""}, about {dailyLimit} a day for about {done.days} working day
                {done.days === 1 ? "" : "s"}.
              </p>
              {done.firstAt && <p className="text-ink-muted">The first email goes out around {new Date(done.firstAt).toLocaleString()}.</p>}
              <p className="text-ink-muted">Replies show up in the Inbox; the Templates page Results shows which email gets replies.</p>
              <Link href={`/campaigns/${done.campaignId}`} className="text-action hover:underline">
                Open the campaign (pause or stop it there) →
              </Link>
            </div>
          ) : (
            plan && (
              <>
                {plan.running && (
                  <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px]">
                    This batch is already being emailed (&ldquo;{plan.running}&rdquo;). Pause or finish it on the Campaigns page before starting another.
                  </div>
                )}
                {plan.senders.length === 0 && (
                  <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px]">No sending mailbox is connected. Connect one on the Email page first.</div>
                )}

                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-rule px-3 py-2">
                    <div className="text-[11px] text-ink-muted">Will get an email</div>
                    <div className="text-[20px] font-semibold mono-num">{plan.eligible}</div>
                    <div className="text-[11px] text-ink-subtle">of {plan.total} leads in the batch</div>
                  </div>
                  <div className="rounded-lg border border-rule px-3 py-2">
                    <div className="text-[11px] text-ink-muted">Checked first</div>
                    <div className="text-[20px] font-semibold mono-num">{plan.toCheck}</div>
                    <div className="text-[11px] text-ink-subtle">never-checked emails are checked right before sending; bad ones are skipped</div>
                  </div>
                  <div className="rounded-lg border border-rule px-3 py-2">
                    <div className="text-[11px] text-ink-muted">Takes about</div>
                    <div className="text-[20px] font-semibold mono-num">{days}</div>
                    <div className="text-[11px] text-ink-subtle">working day{days === 1 ? "" : "s"} at {dailyLimit} a day</div>
                  </div>
                </div>

                {plan.skipped.length > 0 && (
                  <details className="text-[12px] text-ink-muted">
                    <summary className="cursor-pointer">Skipped ({plan.skipped.reduce((a, s) => a + s.count, 0)})</summary>
                    <ul className="mt-1 space-y-0.5 pl-4 list-disc">
                      {plan.skipped.map((s) => (
                        <li key={s.reason}>
                          {s.text}: <span className="mono-num">{s.count}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {plan.groups.map((g) => (
                  <div key={g.offer} className="rounded-lg border border-rule p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold">{g.label}</div>
                      <div className="text-[12px] text-ink-muted">{g.count} lead{g.count === 1 ? "" : "s"}</div>
                    </div>
                    <label className="block text-[11px] font-semibold text-ink-muted">
                      Email to send
                      <select
                        className={INPUT}
                        value={choices[g.offer] ?? "auto"}
                        onChange={(e) => setChoices({ ...choices, [g.offer]: e.target.value })}
                        disabled={starting}
                      >
                        {g.choices.map((c) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                    </label>
                    {g.sample && (
                      <div className="rounded-md bg-surface-alt px-3 py-2 text-[12px] space-y-1">
                        <div className="text-[11px] text-ink-subtle">
                          Sample for {g.sample.to}, from {g.sample.from} · {g.sample.emailLabel}
                        </div>
                        <div className="font-semibold">{g.sample.subject}</div>
                        <pre className="whitespace-pre-wrap font-sans text-ink">{g.sample.body}</pre>
                      </div>
                    )}
                  </div>
                ))}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-[11px] font-semibold text-ink-muted">
                    First emails a day (1–100)
                    <input
                      type="number"
                      min={1}
                      max={100}
                      className={INPUT}
                      value={dailyLimit}
                      onChange={(e) => setDailyLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                      disabled={starting}
                    />
                  </label>
                  <label className="block text-[11px] font-semibold text-ink-muted">
                    Follow-ups if they don&rsquo;t reply
                    <select className={INPUT} value={followUps} onChange={(e) => setFollowUps(Number(e.target.value) as 0 | 1 | 2)} disabled={starting}>
                      <option value={0}>Off: just the first email</option>
                      <option value={1}>1 follow-up (day 4)</option>
                      <option value={2}>2 follow-ups (day 4 and day 8)</option>
                    </select>
                  </label>
                </div>

                <label className="flex items-start gap-2 text-[12px]">
                  <input type="checkbox" className="mt-0.5" checked={contactForms} onChange={(e) => setContactForms(e.target.checked)} disabled={starting} />
                  <span>
                    <span className="font-semibold">
                      Leads with no email: send the offer through their contact form{plan.formLeads ? ` (${plan.formLeads})` : ""}
                    </span>
                    <span className="block text-[11px] text-ink-muted">
                      Only forms on their own website, at most 10 a day (all batches together), about 10 cents each. A form with a CAPTCHA is never solved: those are
                      left for you.
                    </span>
                  </span>
                </label>

                {(plan.euCount > 0 || includeEu) && (
                  <label className="flex items-start gap-2 text-[12px]">
                    <input type="checkbox" className="mt-0.5" checked={includeEu} onChange={(e) => setIncludeEu(e.target.checked)} disabled={starting} />
                    <span>
                      <span className="font-semibold">Include EU / UK leads{plan.euCount ? ` (${plan.euCount})` : ""}</span>
                      <span className="block text-[11px] text-ink-muted">Off by default: the project rule is no EU prospects until GDPR is reviewed. Only switch on if Meny said so.</span>
                    </span>
                  </label>
                )}

                <p className="text-[11px] text-ink-muted">
                  Sent from {plan.senders.join(", ") || "no mailbox"} (each mailbox stays within its warm-up limit). A reply, bounce or unsubscribe stops the emails to that
                  lead. Pause or stop the whole thing on the Campaigns page.
                </p>
              </>
            )
          )}
        </div>

        <footer className="px-5 py-3 border-t border-rule flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={starting}>{done ? "Close" : "Cancel"}</Button>
          {!done && (
            <Button onClick={start} loading={starting} disabled={!canStart}>
              <Mail className="h-4 w-4" /> Start sending
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
}
