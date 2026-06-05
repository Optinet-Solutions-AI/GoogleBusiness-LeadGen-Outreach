/**
 * (dashboard)/inbox/[id]/page.tsx — Email conversation thread for one lead.
 *
 * Inputs:  lead + email_messages (ordered oldest→newest)
 * Outputs: the sent ↔ received thread as chat bubbles, with lead context + a
 *          link to the full lead. Replies are pulled by the Inbox "Sync replies"
 *          action (POST /api/email/sync) which reads IMAP.
 * Used by: route "/inbox/[id]" (opened from the Inbox conversation list)
 *
 * Read-only for now: free-text reply *sending* is the next step — for now,
 * follow up from the lead's detail page.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Mail, Phone } from "lucide-react";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { relativeTime } from "@/lib/format";
import { InboxReply } from "@/components/InboxReply";

export const dynamic = "force-dynamic";

interface Lead {
  id: string;
  business_name: string;
  email: string | null;
  phone: string | null;
  stage: string;
  website_url: string | null;
  website_kind: string | null;
}

interface Msg {
  id: string;
  direction: "outbound" | "inbound";
  subject: string | null;
  body_text: string | null;
  to_addr: string | null;
  status: string;
  created_at: string;
}

interface Mailbox {
  email: string;
  from_name: string | null;
}

interface FormSubmission {
  answers: { name?: string; email?: string; bestTime?: string; details?: string } | null;
  created_at: string;
}

async function getThread(id: string): Promise<{ lead: Lead; messages: Msg[] } | null> {
  if (!isDbConfigured()) return null;
  return safeDb(async (db) => {
    const { data: lead } = await db
      .from("leads")
      .select("id,business_name,email,phone,stage,website_url,website_kind")
      .eq("id", id)
      .maybeSingle();
    if (!lead) return null;
    const { data: msgs } = await db
      .from("email_messages")
      .select("id,direction,subject,body_text,to_addr,status,created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: true })
      .limit(500);
    return { lead: lead as Lead, messages: (msgs ?? []) as Msg[] };
  }, null);
}

/** Latest intake-form submission for this lead (FORM IN leads have no email thread). */
async function getFormSubmission(id: string): Promise<FormSubmission | null> {
  if (!isDbConfigured()) return null;
  return safeDb(async (db) => {
    const { data } = await db
      .from("form_submissions")
      .select("answers,created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data ?? null) as FormSubmission | null;
  }, null);
}

const SOCIAL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  youtube: "YouTube",
  other_social: "social page",
};

async function getMailboxes(): Promise<Mailbox[]> {
  if (!isDbConfigured()) return [];
  return safeDb(async (db) => {
    const { data } = await db
      .from("email_accounts")
      .select("email,from_name")
      .eq("status", "active")
      .not("smtp_host", "is", null)
      .order("created_at", { ascending: true });
    return (data ?? []) as Mailbox[];
  }, []);
}

export default async function ThreadPage({ params }: { params: { id: string } }) {
  const [data, mailboxes, form] = await Promise.all([
    getThread(params.id),
    getMailboxes(),
    getFormSubmission(params.id),
  ]);
  if (!data) notFound();
  const { lead, messages } = data;

  // Reply from the mailbox that received their latest reply (keeps the thread on
  // one inbox); fall back to the first active mailbox.
  const lastInboundTo = [...messages].reverse().find((m) => m.direction === "inbound")?.to_addr;
  const defaultSender = lastInboundTo ?? mailboxes[0]?.email ?? null;

  const isSocial = !!lead.website_kind && lead.website_kind in SOCIAL_LABEL;
  const socialLabel = isSocial ? SOCIAL_LABEL[lead.website_kind as string] : null;

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/inbox"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink transition-colors mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} /> Inbox
      </Link>

      {/* Lead header */}
      <header className="card p-5 mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="editorial-head text-ink text-[22px] leading-tight truncate">{lead.business_name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
            {lead.email && (
              <span className="inline-flex items-center gap-1.5 mono-num">
                <Mail className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.75} /> {lead.email}
              </span>
            )}
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 mono-num hover:text-ink transition-colors">
                <Phone className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.75} /> {lead.phone}
              </a>
            )}
            {isSocial && lead.website_url && (
              <a
                href={lead.website_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-ink transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5 text-ink-subtle" strokeWidth={1.75} /> {socialLabel}
              </a>
            )}
          </div>
        </div>
        <Link href={`/leads/${lead.id}`} className="btn btn-secondary btn-sm flex-shrink-0">
          Open lead
          <ExternalLink strokeWidth={1.75} />
        </Link>
      </header>

      {/* Intake-form submission — the actionable content for FORM IN leads */}
      {form && (
        <section className="card p-5 mb-5 border-l-2 border-l-positive">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="eyebrow text-positive">They filled out your form</p>
            <span className="mono-num text-[11px] text-ink-subtle">{relativeTime(form.created_at)}</span>
          </div>
          <dl className="space-y-2.5 text-[13px]">
            <FormRow label="Name" value={form.answers?.name} />
            <FormRow label="Email" value={form.answers?.email} />
            <FormRow label="Best time to reach" value={form.answers?.bestTime} />
            <FormRow label="What they need" value={form.answers?.details} />
          </dl>
          {!lead.email && (
            <p className="mt-4 pt-3 border-t border-rule text-[12px] text-ink-muted">
              No email on file — reach out
              {lead.phone ? (
                <>
                  {" "}by{" "}
                  <a href={`tel:${lead.phone}`} className="underline underline-offset-2 hover:text-ink">
                    phone
                  </a>
                </>
              ) : null}
              {isSocial && lead.website_url ? (
                <>
                  {lead.phone ? " or" : " via"}{" "}
                  <a
                    href={lead.website_url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-ink"
                  >
                    {socialLabel} DM
                  </a>
                </>
              ) : null}
              .
            </p>
          )}
        </section>
      )}

      {/* Thread */}
      {messages.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-[13px] text-ink-muted">
            {form
              ? "No email thread — this lead came in through the intake form above."
              : lead.email
                ? "No email messages yet. Sent emails appear here once you send from the lead, and replies arrive via Sync replies on the Inbox."
                : "No messages yet. This lead has no email — reach out by phone or DM."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => {
            const out = m.direction === "outbound";
            return (
              <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[82%] rounded-lg px-3.5 py-2.5 ${
                    out ? "bg-ink text-canvas" : "bg-surface border border-rule"
                  }`}
                >
                  {m.subject && (
                    <p className={`text-[11px] font-semibold mb-1 ${out ? "text-canvas/70" : "text-ink-subtle"}`}>
                      {m.subject}
                    </p>
                  )}
                  <p
                    className={`text-[13px] whitespace-pre-wrap break-words leading-relaxed ${
                      out ? "text-canvas" : "text-ink"
                    }`}
                  >
                    {m.body_text || "(no content)"}
                  </p>
                  <p className={`text-[10px] mt-1.5 ${out ? "text-canvas/50" : "text-ink-subtle"}`}>
                    {out ? "Sent" : "Received"} · {relativeTime(m.created_at)}
                    {out && m.status === "failed" ? " · failed" : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lead.email ? (
        <InboxReply leadId={lead.id} mailboxes={mailboxes} defaultSender={defaultSender} />
      ) : !form ? (
        <p className="text-[11px] text-ink-subtle text-center mt-6">
          No email on file for this lead — follow up from the lead&apos;s page.
        </p>
      ) : null}
    </div>
  );
}

function FormRow({ label, value }: { label: string; value?: string | null }) {
  if (!value || !value.trim()) return null;
  return (
    <div className="flex gap-3">
      <dt className="text-ink-subtle w-32 flex-none text-[11px] uppercase tracking-wide font-semibold pt-0.5">
        {label}
      </dt>
      <dd className="text-ink whitespace-pre-wrap break-words flex-1">{value}</dd>
    </div>
  );
}
