/**
 * outreach/EmailPreviewModal.tsx — "Send email" opens this first: see (and edit) exactly what goes out.
 *
 * Inputs:  one or more lead ids; GET /api/leads/:id/sequence/preview per lead
 * Outputs: on Send, POST /api/leads/:id/sequence { action: "enroll", copy: { "1": {subject, body} }, edited }
 *          — the first email is sent exactly as approved. Optional POST …/sequence/translate.
 * Used by: components/leads/ContactCard.tsx, components/LeadsTable.tsx (row + bulk), NextStepPill, SequenceCard
 *
 * Dumb client: what can be sent, from where, when, and in which words all come from the preview API.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Languages, Mail, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { cx } from "@/lib/cx";
import { spamCheck } from "@/lib/email/spam-check";
import { renderSequenceEmail } from "@/lib/email/sequence-templates";
import { displayBody, isEdited, type StepCopy } from "@/lib/email/sequence-preview";
import { enrollToast } from "@/lib/email/enroll-messages";

interface EmailPreview {
  leadId: string;
  businessName: string;
  to: string | null;
  emailState: { label: string; tone: "positive" | "warning" | "urgent" | "muted"; hint: string };
  canSend: boolean;
  block: string | null;
  willVerifyFirst: boolean;
  from: { pinned: string | null; pool: string[] };
  timing: string;
  window: string;
  campaign: string | null;
  style: string;
  pitch: string;
  language: { code: string; name: string | null };
  demoUrl: string | null;
  screenshotUrl: string | null;
  steps: { step: number; day: number; copy: StepCopy }[];
}

type Row = {
  id: string;
  preview: EmailPreview | null;
  error: string | null;
  proposed: StepCopy | null;
  copy: StepCopy | null;
  include: boolean;
  open: boolean;
  translating: boolean;
  translatedTo: string | null;
  result: null | "sent" | "failed";
};

const TONE: Record<string, string> = {
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  urgent: "bg-urgent-soft text-urgent",
  muted: "bg-surface-alt text-ink-subtle",
};

const INPUT =
  "w-full px-3 text-[13px] text-ink border border-rule-strong rounded-lg bg-white focus:ring-2 focus:ring-action/20 focus:border-action outline-none";

async function mapLimit<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

export function EmailPreviewModal({ leadIds, onClose, onDone }: { leadIds: string[]; onClose: () => void; onDone?: () => void }) {
  const single = leadIds.length === 1;
  const [rows, setRows] = useState<Row[]>(() =>
    leadIds.map((id) => ({ id, preview: null, error: null, proposed: null, copy: null, include: false, open: single, translating: false, translatedTo: null, result: null })),
  );
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  useEffect(() => {
    let alive = true;
    mapLimit(leadIds, 4, async (id) => {
      const res = await fetchJson<EmailPreview>(`/api/leads/${id}/sequence/preview`);
      if (!alive) return;
      if (!res.success) patch(id, { error: res.error });
      else {
        const first = res.data.steps[0]?.copy ?? null;
        patch(id, { preview: res.data, proposed: first, copy: first, include: res.data.canSend });
      }
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
  const chosen = rows.filter((r) => r.include && r.preview?.canSend && r.copy);
  const blocked = rows.filter((r) => r.preview && !r.preview.canSend);

  async function translate(r: Row) {
    if (!r.copy || !r.preview?.language.name) return;
    patch(r.id, { translating: true });
    const res = await fetchJson<StepCopy & { language: string }>(`/api/leads/${r.id}/sequence/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r.copy),
    });
    if (!res.success) {
      toast.error(res.error, { title: "Translate" });
      patch(r.id, { translating: false });
    } else {
      patch(r.id, { translating: false, copy: { subject: res.data.subject, body: res.data.body }, translatedTo: res.data.language });
    }
  }

  async function send() {
    if (!chosen.length || sending) return;
    setSending({ done: 0, total: chosen.length });
    let ok = 0;
    let lastVerification: string | null = null;
    let lastError: string | null = null;
    for (const r of chosen) {
      const edited = r.proposed && r.copy ? isEdited(r.proposed, r.copy) : false;
      const res = await fetchJson<{ verification: string | null; copy_saved?: boolean }>(`/api/leads/${r.id}/sequence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enroll", copy: { "1": r.copy }, edited }),
      });
      if (res.success) {
        ok += 1;
        lastVerification = res.data.verification;
        patch(r.id, { result: "sent" });
      } else {
        lastError = res.error;
        patch(r.id, { result: "failed", error: res.error });
      }
      setSending((s) => (s ? { ...s, done: s.done + 1 } : s));
    }
    setSending(null);
    if (single) {
      if (ok) {
        const t = enrollToast(lastVerification);
        toast[t.tone](t.text);
      } else toast.error(lastError ?? "Didn't work", { title: "Email" });
    } else {
      (ok === chosen.length ? toast.success : toast.warning)(
        `${ok} of ${chosen.length} put in the email sequence.${ok < chosen.length ? " The ones that failed say why below." : ""}`,
      );
    }
    onDone?.();
    if (ok === chosen.length) onClose();
  }

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-end sm:items-center justify-center sm:p-4" onClick={() => !sending && onClose()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Email preview"
        className="bg-white w-full sm:max-w-[680px] max-h-[94vh] flex flex-col rounded-t-xl sm:rounded-xl border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-rule">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink truncate">
              {single ? `Email ${rows[0].preview?.businessName ?? "this lead"}` : `Email ${leadIds.length} leads`}
            </h2>
            <p className="text-[12px] text-ink-muted">Check what goes out. Nothing is sent until you press Send.</p>
          </div>
          <button type="button" onClick={onClose} disabled={!!sending} aria-label="Close" className="text-ink-subtle hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading && <p className="text-[13px] text-ink-muted">Preparing the email{single ? "" : "s"}…</p>}
          {rows.map((r) =>
            single ? (
              <LeadEmail key={r.id} row={r} single onChange={(p) => patch(r.id, p)} onTranslate={() => translate(r)} />
            ) : (
              <div key={r.id} className={cx("rounded-lg border", r.result === "failed" ? "border-urgent/40" : "border-rule")}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Include ${r.preview?.businessName ?? "lead"}`}
                    checked={r.include}
                    disabled={!r.preview?.canSend || !!sending}
                    onChange={(e) => patch(r.id, { include: e.target.checked })}
                  />
                  <button type="button" onClick={() => patch(r.id, { open: !r.open })} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                    {r.open ? <ChevronDown className="h-4 w-4 flex-none text-ink-muted" /> : <ChevronRight className="h-4 w-4 flex-none text-ink-muted" />}
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink truncate">{r.preview?.businessName ?? (r.error ? "Couldn't load" : "Loading…")}</span>
                      <span className="block text-[11px] text-ink-muted truncate">
                        {r.preview?.canSend ? `${r.preview.to} · ${r.copy?.subject ?? ""}` : (r.preview?.block ?? r.error ?? "")}
                      </span>
                    </span>
                  </button>
                  {r.result === "sent" && <span className="text-[11px] font-semibold text-positive">Queued</span>}
                  {r.preview && <span className={cx("px-1.5 py-0.5 rounded text-[10px] font-semibold", TONE[r.preview.emailState.tone])}>{r.preview.emailState.label}</span>}
                </div>
                {r.open && r.preview && (
                  <div className="border-t border-rule px-3 py-3">
                    <LeadEmail row={r} single={false} onChange={(p) => patch(r.id, p)} onTranslate={() => translate(r)} />
                  </div>
                )}
              </div>
            ),
          )}
        </div>

        <footer className="px-5 py-3 border-t border-rule flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-ink-muted min-w-0 flex-1">
            {sending
              ? `Sending ${sending.done}/${sending.total}…`
              : !single && blocked.length
                ? `${blocked.length} can't be emailed (open them to see why).`
                : single && rows[0].preview?.willVerifyFirst
                  ? "The address is checked first (under 1 cent). If it's bad, nothing is sent."
                  : "Follow-ups stop on a reply, bounce or unsubscribe."}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={!!sending}>Cancel</Button>
            <Button onClick={send} loading={!!sending} disabled={loading || !chosen.length || !!sending}>
              <Mail strokeWidth={2} /> {single ? "Send first email" : `Send to ${chosen.length}`}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function LeadEmail({ row, single, onChange, onTranslate }: { row: Row; single: boolean; onChange: (p: Partial<Row>) => void; onTranslate: () => void }) {
  const p = row.preview;
  const [showFollowUps, setShowFollowUps] = useState(false);
  const spam = useMemo(() => {
    if (!row.copy) return null;
    const html = renderSequenceEmail({ business_name: p?.businessName ?? "", demo_url: p?.demoUrl ?? null }, 1, row.copy).html;
    return spamCheck(row.copy.subject, html);
  }, [row.copy, p?.businessName, p?.demoUrl]);

  if (!p) return row.error ? <p className="text-[13px] text-urgent">{row.error}</p> : null;
  const edited = row.proposed && row.copy ? isEdited(row.proposed, row.copy) : false;

  return (
    <div className="space-y-3">
      {!p.canSend && (
        <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">
          <span className="font-semibold text-urgent">Can&rsquo;t send: </span>{p.block}
        </div>
      )}
      {row.result === "failed" && row.error && p.canSend && (
        <div className="rounded-lg border border-urgent/30 bg-urgent-soft px-3 py-2 text-[12px] text-ink">{row.error}</div>
      )}

      <dl className="grid grid-cols-[70px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        <dt className="text-ink-muted">To</dt>
        <dd className="text-ink min-w-0 flex flex-wrap items-center gap-1.5">
          <span className="mono-num break-all">{p.to ?? "—"}</span>
          <span className={cx("px-1.5 py-0.5 rounded text-[10px] font-semibold", TONE[p.emailState.tone])}>{p.emailState.label}</span>
        </dd>
        <dt className="text-ink-muted">From</dt>
        <dd className="text-ink break-all">
          {p.from.pinned ?? (p.from.pool.length === 1 ? p.from.pool[0] : p.from.pool.length ? `One of: ${p.from.pool.join(", ")}` : "No mailbox connected")}
          {!p.from.pinned && p.from.pool.length > 1 && <span className="block text-[11px] text-ink-subtle">Picked by daily limits; the same mailbox sends every follow-up.</span>}
        </dd>
        <dt className="text-ink-muted">When</dt>
        <dd className="text-ink">{p.timing}<span className="block text-[11px] text-ink-subtle">Sending hours: {p.window}</span></dd>
        <dt className="text-ink-muted">Pitch</dt>
        <dd className="text-ink">{p.pitch}{p.campaign && <span className="block text-[11px] text-ink-subtle">Campaign: {p.campaign} · {p.style}</span>}</dd>
      </dl>

      {p.language.name && (
        <div className="rounded-lg border border-rule bg-surface-alt px-3 py-2 text-[12px] text-ink flex flex-wrap items-center gap-2 justify-between">
          <span>
            {row.translatedTo
              ? `Translated to ${row.translatedTo}. Read it over; it goes exactly as shown.`
              : `This business probably speaks ${p.language.name}. The first email goes exactly as shown (English unless you translate it).`}
          </span>
          {!row.translatedTo && p.canSend && (
            <Button size="sm" variant="soft" onClick={onTranslate} loading={row.translating}>
              <Languages strokeWidth={2} /> Translate to {p.language.name}
            </Button>
          )}
        </div>
      )}

      {row.copy && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted font-mono">First email · today</p>
            {edited && (
              <button type="button" onClick={() => onChange({ copy: row.proposed, translatedTo: null })} className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink">
                <RotateCcw className="h-3 w-3" /> Back to our wording
              </button>
            )}
          </div>
          <label className="block">
            <span className="sr-only">Subject</span>
            <input
              value={row.copy.subject}
              onChange={(e) => onChange({ copy: { ...row.copy!, subject: e.target.value } })}
              disabled={!p.canSend}
              className={cx(INPUT, "h-9 font-semibold")}
              aria-label="Subject"
            />
          </label>
          <textarea
            value={row.copy.body}
            onChange={(e) => onChange({ copy: { ...row.copy!, body: e.target.value } })}
            disabled={!p.canSend}
            rows={single ? 11 : 8}
            aria-label="Email body"
            className={cx(INPUT, "py-2 leading-relaxed resize-y")}
          />
          <p className="text-[11px] text-ink-subtle">
            Plain text, sent exactly like this. A blank line starts a new paragraph.
            {/\{\{\s*(demo_link|screenshot)\s*\}\}/i.test(row.copy.body) && " {{demo_link}} becomes the live demo link and {{screenshot}} the picture of it."}
          </p>
          {spam && spam.level !== "low" && (
            <p className="text-[11px] text-warning">
              Spam-filter risk: {spam.level}. {spam.flags.slice(0, 3).join(" · ")}
            </p>
          )}
        </div>
      )}

      {p.steps.length > 1 && (
        <div className="rounded-lg border border-rule">
          <button type="button" onClick={() => setShowFollowUps((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-ink">
            {showFollowUps ? <ChevronDown className="h-4 w-4 text-ink-muted" /> : <ChevronRight className="h-4 w-4 text-ink-muted" />}
            Then, if they don&rsquo;t reply: {p.steps.length - 1} follow-up{p.steps.length > 2 ? "s" : ""}
          </button>
          {showFollowUps && (
            <ol className="border-t border-rule divide-y divide-rule">
              {p.steps.slice(1).map((s) => (
                <li key={s.step} className="px-3 py-2.5">
                  <p className="text-[11px] text-ink-muted mb-1">Day {s.day} · <span className="font-semibold text-ink">{s.copy.subject}</span></p>
                  <BodyWithScreenshot body={displayBody(s.copy.body, p.demoUrl)} screenshotUrl={p.screenshotUrl} />
                </li>
              ))}
              <li className="px-3 py-2 text-[11px] text-ink-subtle">
                Follow-ups use the standard wording{p.language.name ? ` and are translated to ${p.language.name} when sent` : ""}. The greeting line varies a little per email.
              </li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function BodyWithScreenshot({ body, screenshotUrl }: { body: string; screenshotUrl: string | null }) {
  const marker = "[ screenshot of their demo site ]";
  const parts = body.split(marker);
  return (
    <div className="text-[12px] text-ink whitespace-pre-wrap leading-relaxed">
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 &&
            (screenshotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={screenshotUrl} alt="Screenshot of their demo site" className="my-1.5 block max-h-40 rounded border border-rule" />
            ) : (
              <span className="my-1.5 block rounded border border-dashed border-rule px-2 py-3 text-center text-[11px] text-ink-subtle">Screenshot of their demo site (taken after Build)</span>
            ))}
        </span>
      ))}
    </div>
  );
}
