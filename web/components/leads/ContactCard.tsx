/**
 * leads/ContactCard.tsx — the one place on a lead page for "who do we contact, and how".
 *
 * Inputs:  the lead's contact fields (phone, email + verification, owner, contact page, sources, country, stage)
 * Outputs: phone (tap to call), email with a plain status + edit + re-check, owner, sources, More emails / phones,
 *          hand edits of phone / website / contact page (PATCH /api/leads/:id, 23 Nov 2026), a warning when the email
 *          isn't on their website's domain (lib/leads/email-site.ts),
 *          (other_emails / other_phones, "Use this" → /ai-profile/decide), a Contact page button; and the actions:
 *          Send email (SimpleEmailModal), Contact page (ContactFormModal: their form, AI fills + sends it, or open the
 *          page; merged with the old separate "Contact page" link on 24 Nov 2026),
 *          Test voice agent (VoiceTestModal, browser call), Research
 *          business (POST /ai-profile: OpenAI + their site; the findings show in ResearchPanel below this card)
 * Used by: app/(dashboard)/leads/[id]/page.tsx
 *
 * Dumb client: all rules live in lib/leads/contact-readiness.ts and the API routes. Replaces the old scattered
 * pieces (right-rail Contact section, "Contact details found" box, Email verification card).
 */
"use client";

import { LINK_TEXT, linkKind, type LinkChecks } from "@/lib/leads/link-check";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, ExternalLink, Globe, Mail, Pencil, Phone, PhoneCall, RefreshCw, Search, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { contactReadiness, type ContactFields } from "@/lib/leads/contact-readiness";
import { cx } from "@/lib/cx";
import { SimpleEmailModal } from "@/components/outreach/SimpleEmailModal";
import { VoiceTestModal } from "@/components/outreach/VoiceTestModal";
import { ContactFormModal } from "@/components/outreach/ContactFormModal";
import { ContactFormStatus } from "@/components/leads/ContactFormStatus";
import { leadHost } from "@/lib/contact-form/rules";
import { emailSiteMismatch } from "@/lib/leads/email-site";

/** The fields that can be typed by hand on this card. */
type EditField = "email" | "phone" | "website_url" | "contact_page_url";
const EDIT_LABEL: Record<EditField, string> = { email: "email", phone: "phone", website_url: "website", contact_page_url: "contact page" };
const EDIT_PLACEHOLDER: Record<EditField, string> = {
  email: "name@business.com",
  phone: "(251) 555-0123",
  website_url: "theirbusiness.com",
  contact_page_url: "theirbusiness.com/contact",
};
const INPUT_CLS =
  "min-w-0 flex-1 h-8 px-2 text-[13px] border border-rule-strong rounded-md focus:ring-2 focus:ring-action/20 focus:border-action outline-none";
const ICON_BTN = "p-1 rounded text-ink-subtle hover:text-ink hover:bg-surface";

export interface ContactCardLead extends ContactFields {
  id: string;
  business_name: string;
  stage: string;
  contact_owner_role: string | null;
  contact_page_url: string | null;
  /** Their website: the Contact form button needs a website or a contact page. */
  website_url?: string | null;
  contact_sources: string[] | null;
  /** Liquidation / exhibitor leads (Send email defaults to their inventory / stand offer). */
  isSignal: boolean;
  /** Extra emails / phones kept when another one became the main (migration 062). */
  other_emails?: { value: string; source: string; added_at: string }[] | null;
  other_phones?: { value: string; source: string; added_at: string }[] | null;
  /** Does the contact page open (migration 080; checked during scraping). */
  link_checks?: LinkChecks | null;
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
  const [busy, setBusy] = useState<null | "find" | "verify" | "save" | "use">(null);
  const [editing, setEditing] = useState<EditField | null>(null);
  const [draft, setDraft] = useState("");
  const [showSources, setShowSources] = useState(false);
  const [preview, setPreview] = useState<null | "email" | "voice" | "form">(null);
  const [showMore, setShowMore] = useState<null | "email" | "phone">(null);

  // Open-to-edit when another card asks for it (the Next step banner's "Add an email").
  useEffect(() => {
    const open = () => {
      setDraft(lead.email ?? "");
      setEditing("email");
      document.getElementById("contact-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("lead-actions:edit-email", open);
    return () => window.removeEventListener("lead-actions:edit-email", open);
  }, [lead.email]);

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

  // AI Lookup = OpenAI web search + a free scan of their own site. Findings show in the panel below.
  const research = () =>
    run(
      "find",
      () => fetchJson<{ filled: string[]; aiNote: string | null }>(`/api/leads/${lead.id}/ai-profile`, { method: "POST" }),
      (d) => {
        const added = d.filled.length ? ` Added to the lead: ${d.filled.join(", ")}.` : "";
        toast.success(`Done. The findings are below the Contact card; verify or remove each one.${added}`, { title: "AI Lookup" });
        if (d.aiNote) toast.warning(d.aiNote);
      },
    );
  const switchMain = (kind: "email" | "phone", value: string) =>
    run(
      "use",
      () => fetchJson<{ message: string }>(`/api/leads/${lead.id}/ai-profile/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ use: { kind, value } }) }),
      (d) => toast.success(d.message),
    );
  const reverify = () =>
    run(
      "verify",
      () => fetchJson<{ results: Record<string, string> }>("/api/verify/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds: [lead.id] }) }),
      (d) => toast.success(`Email check: ${d.results[lead.id] ?? "done"}.`),
    );
  const current: Record<EditField, string | null> = {
    email: lead.email,
    phone: lead.phone,
    website_url: lead.website_url ?? null,
    contact_page_url: lead.contact_page_url,
  };
  // A link that doesn't open (checked during scraping), or a social page that can't be checked automatically.
  const linkNote = (field: "website_url" | "contact_page_url"): string | null => {
    const url = current[field];
    if (!url) return null;
    if (linkKind(url) === "social") return LINK_TEXT.unchecked;
    const c = field === "contact_page_url" ? lead.link_checks?.contact_page : undefined;
    return c && c.url === url && (c.state === "dead" || c.state === "unknown") ? LINK_TEXT[c.state] : null;
  };
  const startEdit = (field: EditField) => {
    setDraft(current[field] ?? "");
    setEditing(field);
  };
  const save = () => {
    if (!editing) return;
    const field = editing;
    const value = draft.trim() || null;
    return run(
      "save",
      () => fetchJson(`/api/leads/${lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) }),
      () => {
        setEditing(null);
        if (!value) toast.success(`The ${EDIT_LABEL[field]} was removed.`);
        else if (field === "email") toast.success("Email saved — it gets checked when you send.");
        else if (field === "website_url") toast.success("Website saved. The old website check was cleared; pick the pitch in Website verdict.");
        else toast.success(`The ${EDIT_LABEL[field]} was saved.`);
      },
    );
  };
  const editBox = (field: EditField) => (
    <div className="flex gap-1.5">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setEditing(null);
        }}
        type={field === "email" ? "email" : field === "phone" ? "tel" : "url"}
        placeholder={EDIT_PLACEHOLDER[field]}
        aria-label={`Type the ${EDIT_LABEL[field]}`}
        className={INPUT_CLS}
        autoFocus
      />
      <Button size="sm" onClick={save} loading={busy === "save"}>Save</Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
    </div>
  );
  const pencil = (field: EditField) => (
    <button
      type="button"
      onClick={() => startEdit(field)}
      disabled={!!busy}
      title={current[field] ? `Edit the ${EDIT_LABEL[field]}` : `Type the ${EDIT_LABEL[field]}`}
      aria-label={current[field] ? `Edit the ${EDIT_LABEL[field]}` : `Type the ${EDIT_LABEL[field]}`}
      className={ICON_BTN}
    >
      <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
  const mismatch = emailSiteMismatch(lead.email, lead.website_url);

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
          {editing === "phone" ? (
            editBox("phone")
          ) : (
            <div className="flex items-center justify-between gap-2">
              {lead.phone ? (
                <a href={phoneHref ?? undefined} className="mono-num text-[15px] text-ink hover:text-action inline-flex items-center gap-1.5">
                  <Phone className="h-4 w-4 text-ink-muted" strokeWidth={1.75} /> {lead.phone}
                </a>
              ) : (
                <span className="text-[13px] text-ink-subtle">No phone</span>
              )}
              {pencil("phone")}
            </div>
          )}
          <div className="text-[11px] text-ink-subtle mt-1">{r.callBlock ?? "AI can call this number."}</div>
        </div>

        {/* Email */}
        <div className="rounded-lg border border-rule bg-surface-alt px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted font-mono">Email</span>
            <span className={cx("px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none", TONE[r.email.tone])}>{r.email.label}</span>
          </div>
          {editing === "email" ? (
            editBox("email")
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="mono-num text-[13px] text-ink truncate">{lead.email ?? <span className="text-ink-subtle">—</span>}</span>
              <span className="flex items-center gap-1 flex-none">
                {lead.email && (
                  <button type="button" onClick={reverify} disabled={!!busy} title="Re-check this address" className="p-1 rounded text-ink-subtle hover:text-ink hover:bg-surface">
                    <RefreshCw className={cx("h-3.5 w-3.5", busy === "verify" && "animate-spin")} strokeWidth={1.75} />
                  </button>
                )}
                {pencil("email")}
              </span>
            </div>
          )}
          <div className="text-[11px] text-ink-subtle mt-1">{r.email.hint}</div>
          {mismatch && editing !== "email" && (
            <div role="alert" className="mt-1.5 rounded border border-warning/40 bg-warning-soft px-2 py-1 text-[11px] text-ink">
              This email is on <span className="font-semibold">{mismatch.emailDomain}</span>, not their website ({mismatch.siteDomain}). Check it&rsquo;s
              really theirs before sending.
            </div>
          )}
        </div>
      </div>

      {/* Website + contact page: typed by hand when the scraper or AI Lookup got them wrong (QA 23 Nov 2026). */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(["website_url", "contact_page_url"] as const).map((field) => (
          <div key={field} className="rounded-lg border border-rule px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted font-mono mb-1">
              {field === "website_url" ? "Website" : "Contact page"}
            </div>
            {editing === field ? (
              editBox(field)
            ) : (
              <div className="flex items-center justify-between gap-2">
                {current[field] ? (
                  <a href={current[field]!} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[12px] text-action hover:underline inline-flex items-center gap-1">
                    <Globe className="h-3.5 w-3.5 flex-none text-ink-muted" strokeWidth={1.75} />
                    <span className="truncate">{current[field]!.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                  </a>
                ) : (
                  <span className="text-[12px] text-ink-subtle">{field === "website_url" ? "No website" : "No contact page"}</span>
                )}
                {pencil(field)}
              </div>
            )}
            {editing !== field && linkNote(field) && <p className="mt-1 text-[11px] text-warning">{linkNote(field)}</p>}
          </div>
        ))}
      </div>

      {/* More emails / phones: kept when another one became the main (never deleted). */}
      {((lead.other_emails?.length ?? 0) > 0 || (lead.other_phones?.length ?? 0) > 0) && (
        <div className="mt-3 text-[11px] text-ink-muted space-y-1.5">
          <div className="flex flex-wrap gap-3">
            {(["email", "phone"] as const).map((kind) => {
              const list = (kind === "email" ? lead.other_emails : lead.other_phones) ?? [];
              if (!list.length) return null;
              return (
                <button key={kind} type="button" onClick={() => setShowMore((v) => (v === kind ? null : kind))} className="underline underline-offset-2 hover:text-ink">
                  {showMore === kind ? `Hide more ${kind}s` : `More ${kind}s (${list.length})`}
                </button>
              );
            })}
          </div>
          {showMore && (
            <ul className="rounded-lg border border-rule divide-y divide-rule">
              {((showMore === "email" ? lead.other_emails : lead.other_phones) ?? []).map((o) => (
                <li key={o.value} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="mono-num text-[12px] text-ink break-all">{o.value}</span>
                  <span className="flex items-center gap-2 flex-none">
                    <span className="text-ink-subtle">{o.source === "replaced" ? "was the main one" : "from research"}</span>
                    <button type="button" onClick={() => switchMain(showMore, o.value)} disabled={!!busy} className="rounded border border-rule px-2 py-0.5 font-semibold text-ink hover:bg-surface-alt disabled:opacity-50">
                      Use this
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(lead.contact_sources?.length ?? 0) > 0 && (
        <div className="mt-3 text-[11px] text-ink-muted">
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
          <Button onClick={() => setPreview("email")} disabled={!r.canEmail || !!busy} title={r.canEmail ? "Pick a service, check the email, send" : r.email.hint}>
            <Mail strokeWidth={2} /> Send email
          </Button>
          {/* Talk to the voice agent from the browser with this lead's details. Nothing is dialled, so any lead works. */}
          <Button
            variant="soft-action"
            onClick={() => setPreview("voice")}
            disabled={!!busy}
            title="Talk to the voice agent from your browser with this lead's details (no phone call)"
          >
            <PhoneCall strokeWidth={2} /> Test voice agent
          </Button>
          <Button variant="soft" onClick={research} loading={busy === "find"} disabled={!!busy} title="OpenAI web search + their own website: owner, emails, phones, contact page, services and more. About 2–5 cents, up to a minute.">
            <Search strokeWidth={2} /> AI Lookup
          </Button>
          {/* One "Contact page" button (merged 24 Nov 2026): on their own site it opens the contact-form window (their form,
              send a message through it, or open the page); a contact page elsewhere (not their site) just opens. */}
          {leadHost({ website_url: lead.website_url ?? null, contact_page_url: lead.contact_page_url }) ? (
            <Button
              variant="soft"
              onClick={() => setPreview("form")}
              disabled={!!busy}
              title="See their website's contact form and send a message through it (AI fills it in; free to look, sending costs a few cents), or open the page"
            >
              <ClipboardList strokeWidth={2} /> Contact page
            </Button>
          ) : (
            lead.contact_page_url && (
              <a href={lead.contact_page_url} target="_blank" rel="noreferrer" className="btn btn-soft" title="Open their contact page">
                Contact page <ExternalLink strokeWidth={2} />
              </a>
            )
          )}
        </div>
      )}
      {/* Where a contact form send stands, without opening its window (26 Nov 2026): live while AI works, with Cancel. */}
      {leadHost({ website_url: lead.website_url ?? null, contact_page_url: lead.contact_page_url }) && (
        <ContactFormStatus leadId={lead.id} watch={preview} onOpen={() => setPreview("form")} onChange={() => router.refresh()} />
      )}
      {busy === "find" && (
        <p className="mt-2 text-[11px] text-ink-subtle">Asking OpenAI and scanning their website… this takes up to a minute. AI results can be wrong; you verify each one.</p>
      )}
      {preview === "email" && lead.email && (
        <SimpleEmailModal leadId={lead.id} onClose={() => setPreview(null)} onDone={() => router.refresh()} />
      )}
      {preview === "voice" && <VoiceTestModal leadId={lead.id} onClose={() => setPreview(null)} />}
      {preview === "form" && (
        <ContactFormModal leadId={lead.id} contactPageUrl={lead.contact_page_url} onClose={() => setPreview(null)} onDone={() => router.refresh()} />
      )}
    </section>
  );
}
