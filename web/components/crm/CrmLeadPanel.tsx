"use client";

/**
 * crm/CrmLeadPanel.tsx — slide-over for one lead: contact, quick links, follow-up, owner, tags, notes, timeline.
 *
 * Inputs:  card (board state), crmReady, onClose, onChange(patch) → the board updates its copy
 * Outputs: PATCH /api/leads/:id (next_follow_up_at, assigned_to, tags, stage),
 *          POST /api/leads/:id/notes, GET /api/leads/:id/timeline
 * Used by: components/crm/CrmBoard.tsx
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  X, Phone, Mail, Globe, ExternalLink, MessageSquareText, ArrowUpRight, Loader2,
  CalendarClock, User, Tag, StickyNote, ArrowRight, PhoneCall, AlertTriangle, MailOpen,
} from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { Button } from "@/components/ui/Button";
import { StageChip } from "@/components/StageChip";
import { relativeTime } from "@/lib/format";
import { cx } from "@/lib/cx";
import { CRM_COLUMNS, normaliseTags, type CrmCard } from "@/lib/crm/board";
import type { TimelineItem, TimelineKind } from "@/lib/crm/timeline-merge";

const INPUT = "h-9 w-full rounded-lg border border-rule-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20";
const LABEL = "block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1";

const KIND_ICON: Record<TimelineKind, { icon: typeof Mail; cls: string }> = {
  email_out: { icon: Mail, cls: "text-action" },
  email_in: { icon: MailOpen, cls: "text-urgent" },
  email_issue: { icon: AlertTriangle, cls: "text-warning" },
  call: { icon: PhoneCall, cls: "text-action" },
  stage: { icon: ArrowRight, cls: "text-ink-muted" },
  note: { icon: StickyNote, cls: "text-positive" },
  event: { icon: MessageSquareText, cls: "text-ink-muted" },
};

/** Local datetime → ISO (what the API stores). */
function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** ISO → value for <input type="datetime-local"> in the operator's zone. */
function toLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function plusDays(n: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function CrmLeadPanel({
  card,
  crmReady,
  onClose,
  onChange,
}: {
  card: CrmCard;
  crmReady: boolean;
  onClose: () => void;
  onChange: (patch: Partial<CrmCard>) => void;
}) {
  const [timeline, setTimeline] = useState<TimelineItem[] | null>(null);
  const [followUp, setFollowUp] = useState(toLocal(card.next_follow_up_at));
  const [owner, setOwner] = useState(card.assigned_to ?? "");
  const [tagText, setTagText] = useState(card.tags.join(", "));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    setFollowUp(toLocal(card.next_follow_up_at));
    setOwner(card.assigned_to ?? "");
    setTagText(card.tags.join(", "));
  }, [card.id, card.next_follow_up_at, card.assigned_to, card.tags]);

  useEffect(() => {
    let alive = true;
    setTimeline(null);
    fetchJson<TimelineItem[]>(`/api/leads/${card.id}/timeline`).then((r) => {
      if (alive) setTimeline(r.success ? r.data : []);
    });
    return () => {
      alive = false;
    };
  }, [card.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function patch(body: Record<string, unknown>, label: string, local: Partial<CrmCard>) {
    setSaving(label);
    const r = await fetchJson<unknown>(`/api/leads/${card.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(null);
    if (!r.success) return toast.error(r.error, { title: `Could not save ${label}` });
    onChange(local);
    toast.success(`${label} saved`);
    if ("stage" in body) refreshTimeline();
  }
  function refreshTimeline() {
    fetchJson<TimelineItem[]>(`/api/leads/${card.id}/timeline`).then((r) => r.success && setTimeline(r.data));
  }
  async function addNote() {
    const body = note.trim();
    if (!body) return;
    setSaving("note");
    const r = await fetchJson<{ id: string; created_at: string }>(`/api/leads/${card.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author: owner || undefined }),
    });
    setSaving(null);
    if (!r.success) return toast.error(r.error, { title: "Could not add the note" });
    setNote("");
    setTimeline((t) => [{ id: `note:${r.data.id}`, ts: r.data.created_at, kind: "note", title: owner ? `Note by ${owner}` : "Note", detail: body }, ...(t ?? [])]);
  }

  const stageOptions = CRM_COLUMNS.filter((c) => c.dropStage).map((c) => ({ value: c.dropStage as string, label: c.label }));
  const currentStageOpt = stageOptions.find((o) => o.value === card.stage)?.value ?? "";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={card.business_name}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[440px] flex-col border-l border-rule bg-surface shadow-hero"
      >
        <header className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold text-ink">{card.business_name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
              <StageChip stage={card.stage} />
              {card.category && <span>{card.category}</span>}
              <span>· updated {relativeTime(card.updated_at)}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-surface-alt hover:text-ink" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
          {/* Contact + links */}
          <section className="space-y-1.5 text-[13px]">
            {card.phone && (
              <div className="flex items-center gap-2 text-ink"><Phone className="h-3.5 w-3.5 text-ink-subtle" /> <span className="select-all">{card.phone}</span></div>
            )}
            {card.email && (
              <div className="flex items-center gap-2 text-ink"><Mail className="h-3.5 w-3.5 text-ink-subtle" /> <span className="select-all break-all">{card.email}</span></div>
            )}
            {card.address && <div className="text-[12px] text-ink-muted pl-5.5">{card.address}</div>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              <Link href={`/leads/${card.id}`} className="inline-flex items-center gap-1 text-action hover:underline">Open lead <ArrowUpRight className="h-3 w-3" /></Link>
              <Link href={`/inbox/${card.id}`} className="inline-flex items-center gap-1 text-action hover:underline">Inbox thread <MessageSquareText className="h-3 w-3" /></Link>
              {card.demo_url && (
                <a href={card.demo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-action hover:underline">Demo site <Globe className="h-3 w-3" /><ExternalLink className="h-3 w-3 opacity-60" /></a>
              )}
            </div>
          </section>

          {/* Stage */}
          <section>
            <span className={LABEL}>Stage</span>
            <select
              id="crm-stage"
              value={currentStageOpt}
              onChange={(e) => e.target.value && patch({ stage: e.target.value }, "Stage", { stage: e.target.value })}
              className={INPUT}
            >
              {!currentStageOpt && <option value="">Not contacted (pipeline)</option>}
              {stageOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </section>

          {/* Follow-up / owner / tags */}
          <section className={cx("space-y-3", !crmReady && "opacity-60 pointer-events-none")}>
            {!crmReady && <p className="text-[12px] text-warning">Run migration 054 to use follow-ups, owner and tags.</p>}
            <div>
              <span className={LABEL}><CalendarClock className="inline h-3 w-3 mr-1" />Next follow-up</span>
              <div className="flex gap-2">
                <input id="crm-followup" type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={INPUT} />
                <Button size="sm" variant="secondary" loading={saving === "Follow-up"} onClick={() => patch({ next_follow_up_at: toIso(followUp) }, "Follow-up", { next_follow_up_at: toIso(followUp) })}>Save</Button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                {[["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7]].map(([l, n]) => (
                  <button key={l} type="button" className="rounded border border-rule px-2 py-0.5 text-ink-muted hover:border-rule-strong hover:text-ink" onClick={() => { const iso = plusDays(n as number); setFollowUp(toLocal(iso)); void patch({ next_follow_up_at: iso }, "Follow-up", { next_follow_up_at: iso }); }}>{l}</button>
                ))}
                {card.next_follow_up_at && (
                  <button type="button" className="rounded border border-rule px-2 py-0.5 text-ink-muted hover:text-urgent" onClick={() => { setFollowUp(""); void patch({ next_follow_up_at: null }, "Follow-up", { next_follow_up_at: null }); }}>Clear</button>
                )}
              </div>
            </div>
            <div>
              <span className={LABEL}><User className="inline h-3 w-3 mr-1" />Owner</span>
              <div className="flex gap-2">
                <input id="crm-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Who is handling this" className={INPUT} onBlur={() => owner.trim() !== (card.assigned_to ?? "") && patch({ assigned_to: owner.trim() || null }, "Owner", { assigned_to: owner.trim() || null })} />
              </div>
            </div>
            <div>
              <span className={LABEL}><Tag className="inline h-3 w-3 mr-1" />Tags</span>
              <input
                id="crm-tags"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                placeholder="hot, price-sensitive, wants-call"
                className={INPUT}
                onBlur={() => {
                  const tags = normaliseTags(tagText.split(","));
                  if (tags.join() !== card.tags.join()) { setTagText(tags.join(", ")); void patch({ tags }, "Tags", { tags }); }
                }}
              />
            </div>
          </section>

          {/* Note */}
          <section>
            <span className={LABEL}><StickyNote className="inline h-3 w-3 mr-1" />Add a note</span>
            <textarea id="crm-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What happened, what they want, what's next…" className={cx(INPUT, "h-auto py-2 resize-y")} />
            <div className="mt-1.5 flex justify-end">
              <Button size="sm" loading={saving === "note"} disabled={!note.trim()} onClick={addNote}>Add note</Button>
            </div>
          </section>

          {/* Timeline */}
          <section>
            <span className={LABEL}>Timeline</span>
            {timeline === null ? (
              <div className="flex items-center gap-2 py-4 text-[12px] text-ink-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
            ) : timeline.length === 0 ? (
              <p className="py-3 text-[12px] text-ink-subtle">Nothing yet. Emails, calls, stage changes and notes show up here.</p>
            ) : (
              <ol className="relative border-l border-rule ml-1.5 space-y-3 pt-1">
                {timeline.map((t) => {
                  const { icon: Icon, cls } = KIND_ICON[t.kind];
                  return (
                    <li key={t.id} className="pl-4">
                      <span className={cx("absolute -left-[7px] mt-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface", cls)}><Icon className="h-3 w-3" /></span>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] text-ink">{t.title}</span>
                        <span className="shrink-0 mono-num text-[11px] text-ink-subtle" title={new Date(t.ts).toLocaleString()}>{relativeTime(t.ts)}</span>
                      </div>
                      {t.detail && <p className={cx("text-[12px] text-ink-muted", t.kind === "note" ? "whitespace-pre-wrap" : "truncate")}>{t.detail}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
