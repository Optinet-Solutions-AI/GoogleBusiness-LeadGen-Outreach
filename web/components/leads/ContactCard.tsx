/**
 * leads/ContactCard.tsx — the one place on a lead page for "who do we contact, and how".
 *
 * Inputs:  the lead's contact fields (phone, email + verification, owner, contact page, sources, country, stage)
 * Outputs: phone (tap to call), email with a plain status + edit + re-check, owner, sources; and the three
 *          actions: Send email and Call with AI open a preview first (EmailPreviewModal / CallPreviewModal);
 *          Find contacts (AI) (→ /contacts) runs straight away
 * Used by: app/(dashboard)/leads/[id]/page.tsx
 *
 * Dumb client: all rules live in lib/leads/contact-readiness.ts and the API routes. Replaces the old scattered
 * pieces (right-rail Contact section, "Contact details found" box, Email verification card).
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Mail, Pencil, Phone, PhoneCall, RefreshCw, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { contactReadiness, type ContactFields } from "@/lib/leads/contact-readiness";
import { cx } from "@/lib/cx";
import { EmailPreviewModal } from "@/components/outreach/EmailPreviewModal";
import { CallPreviewModal } from "@/components/outreach/CallPreviewModal";

export interface ContactCardLead extends ContactFields {
  id: string;
  stage: string;
  contact_owner_role: string | null;
  contact_page_url: string | null;
  contact_sources: string[] | null;
  /** Liquidation / exhibitor leads use the plain offer email (SignalOfferCard), not the sequence. */
  isSignal: boolean;
}

const TONE: Record<"positive" | "warning" | "urgent" | "muted", string> = {
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  urgent: "bg-urgent-soft text-urgent",
  muted: "bg-surface-alt text-ink-subtle",
};

export function ContactCard({ lead }: { lead: ContactCardLead }) {
  const router = useRouter();
  const r = contactReadiness(lead);
  const [busy, setBusy] = useState<null | "find" | "verify" | "save">(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lead.email ?? "");
  const [showSources, setShowSources] = useState(false);
  const [preview, setPreview] = useState<null | "email" | "call">(null);

  // Open-to-edit when another card asks for it (the Next step banner's "Add an email").
  useEffect(() => {
    const open = () => {
      setEditing(true);
      document.getElementById("contact-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("lead-actions:edit-email", open);
    return () => window.removeEventListener("lead-actions:edit-email", open);
  }, []);

  async function run<T>(what: typeof busy, req: () => Promise<{ success: true; data: T } | { success: false; error: string }>, onOk: (d: T) => void) {
    if (busy) return;
    setBusy(what);
    try {
      const res = await req();
      if (!res.success) toast.error(res.error, { title: "Didn't work" });
      else onOk(res.data);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const findContacts = () =>
    run("find", () => fetchJson<{ message: string }>(`/api/leads/${lead.id}/contacts`, { method: "POST" }), (d) => toast.success(d.message, { title: "Contact research" }));
  const reverify = () =>
    run(
      "verify",
      () => fetchJson<{ results: Record<string, string> }>("/api/verify/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds: [lead.id] }) }),
      (d) => toast.success(`Email check: ${d.results[lead.id] ?? "done"}.`),
    );
  const saveEmail = () =>
    run(
      "save",
      () => fetchJson(`/api/leads/${lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: draft.trim() || null }) }),
      () => {
        setEditing(false);
        toast.success(draft.trim() ? "Email saved — it gets checked when you send." : "Email removed.");
      },
    );

  const phoneHref = lead.phone ? `tel:${lead.phone.replace(/[^\d+]/g, "")}` : null;
  const closed = ["closed_won", "closed_lost", "dead", "handed_over"].includes(lead.stage);

  return (
    <section id="contact-card" className="bg-surface border border-rule rounded-lg p-5 scroll-mt-20">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="eyebrow">Contact</p>
        {r.hasOwner && (
          <span className="inline-flex items-center gap-1 text-[12px] text-ink">
            <User className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
            <span className="font-semibold">{lead.contact_owner_name}</span>
            {lead.contact_owner_role && <span className="text-ink-muted">· {lead.contact_owner_role}</span>}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Phone */}
        <div className="rounded-lg border border-rule bg-surface-alt px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted font-mono mb-1">Phone</div>
          {lead.phone ? (
            <a href={phoneHref ?? undefined} className="mono-num text-[15px] text-ink hover:text-action inline-flex items-center gap-1.5">
              <Phone className="h-4 w-4 text-ink-muted" strokeWidth={1.75} /> {lead.phone}
            </a>
          ) : (
            <span className="text-[13px] text-ink-subtle">No phone</span>
          )}
          <div className="text-[11px] text-ink-subtle mt-1">{r.callBlock ?? "AI can call this number."}</div>
        </div>

        {/* Email */}
        <div className="rounded-lg border border-rule bg-surface-alt px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted font-mono">Email</span>
            <span className={cx("px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none", TONE[r.email.tone])}>{r.email.label}</span>
          </div>
          {editing ? (
            <div className="flex gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                type="email"
                placeholder="name@business.com"
                className="min-w-0 flex-1 h-8 px-2 text-[13px] border border-rule-strong rounded-md focus:ring-2 focus:ring-action/20 focus:border-action outline-none"
                autoFocus
              />
              <Button size="sm" onClick={saveEmail} loading={busy === "save"}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(lead.email ?? ""); }}>Cancel</Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="mono-num text-[13px] text-ink truncate">{lead.email ?? <span className="text-ink-subtle">—</span>}</span>
              <span className="flex items-center gap-1 flex-none">
                {lead.email && (
                  <button type="button" onClick={reverify} disabled={!!busy} title="Re-check this address" className="p-1 rounded text-ink-subtle hover:text-ink hover:bg-surface">
                    <RefreshCw className={cx("h-3.5 w-3.5", busy === "verify" && "animate-spin")} strokeWidth={1.75} />
                  </button>
                )}
                <button type="button" onClick={() => setEditing(true)} title={lead.email ? "Edit email" : "Type an email"} className="p-1 rounded text-ink-subtle hover:text-ink hover:bg-surface">
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </span>
            </div>
          )}
          <div className="text-[11px] text-ink-subtle mt-1">{r.email.hint}</div>
        </div>
      </div>

      {(lead.contact_page_url || (lead.contact_sources?.length ?? 0) > 0) && (
        <div className="mt-3 text-[11px] text-ink-muted">
          {lead.contact_page_url && (
            <a href={lead.contact_page_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-action hover:underline mr-3">
              Their contact page <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
          {(lead.contact_sources?.length ?? 0) > 0 && (
            <button type="button" onClick={() => setShowSources((v) => !v)} className="underline underline-offset-2 hover:text-ink">
              {showSources ? "Hide sources" : `Where this came from (${lead.contact_sources!.length})`}
            </button>
          )}
          {showSources && (
            <ul className="mt-1.5 list-disc pl-4 space-y-0.5">
              {lead.contact_sources!.slice(0, 8).map((s) => (
                <li key={s} className="break-all"><a href={s} target="_blank" rel="noreferrer" className="hover:underline">{s}</a></li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!closed && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!lead.isSignal && (
            <Button onClick={() => setPreview("email")} disabled={!r.canEmail || !!busy} title={r.canEmail ? "See the email before it goes out" : r.email.hint}>
              <Mail strokeWidth={2} /> Send email
            </Button>
          )}
          <Button variant="soft-action" onClick={() => setPreview("call")} disabled={!!r.callBlock || !!busy} title={r.callBlock ?? "See what the AI agent will know, then queue the call"}>
            <PhoneCall strokeWidth={2} /> Call with AI
          </Button>
          <Button variant="soft" onClick={findContacts} loading={busy === "find"} disabled={!!busy} title="OpenAI web search + their website: email, phone, owner. About 3 cents, 10–40 s.">
            <Sparkles strokeWidth={2} /> Find contacts (AI)
          </Button>
        </div>
      )}
      {busy === "find" && <p className="mt-2 text-[11px] text-ink-subtle">Searching the web and their site… this takes up to 40 seconds.</p>}
      {preview === "email" && <EmailPreviewModal leadIds={[lead.id]} onClose={() => setPreview(null)} onDone={() => router.refresh()} />}
      {preview === "call" && <CallPreviewModal leadIds={[lead.id]} onClose={() => setPreview(null)} onDone={() => router.refresh()} />}
    </section>
  );
}
