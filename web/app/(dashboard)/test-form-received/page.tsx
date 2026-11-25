/**
 * (dashboard)/test-form-received/page.tsx — what the RateUp test contact form received, newest first.
 *
 * Inputs:  lib/test-form.ts listTestFormMessages (latest 50)
 * Outputs: a read-only list (name, email, phone, subject, message, when)
 * Used by: QA / the operator, to see a contact-form send arrive (workflows/send_contact_form.md)
 */
import Link from "next/link";
import { safeDb, isDbConfigured } from "@/lib/safe-db";
import { listTestFormMessages, MISSING_071 } from "@/lib/test-form";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TestFormReceivedPage() {
  const r = isDbConfigured() ? await safeDb(() => listTestFormMessages(), { messages: [], missing: false }) : { messages: [], missing: false };
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-[20px] font-semibold text-ink">Test form: received</h1>
        <p className="text-[13px] text-ink-muted">
          Messages sent to the RateUp test contact page (<Link className="text-action hover:underline" href="/test-form">/test-form</Link>).
          To test a contact-form send, set a test lead&rsquo;s website to this app&rsquo;s address and its contact page to /test-form.
          Refresh to see new ones.
        </p>
      </div>
      {r.missing && <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-ink">{MISSING_071}</p>}
      {!r.missing && r.messages.length === 0 && <p className="text-[13px] text-ink-muted">Nothing received yet.</p>}
      <ul className="space-y-3">
        {r.messages.map((m) => (
          <li key={m.id} className="rounded-lg border border-rule bg-surface p-4 space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[14px] font-semibold text-ink">{m.subject || "(no subject)"}</span>
              <span className="text-[12px] text-ink-subtle">{relativeTime(m.created_at)}</span>
            </div>
            <div className="text-[12px] text-ink-muted">
              {m.name} · {m.email}
              {m.phone ? ` · ${m.phone}` : ""}
            </div>
            <p className="text-[13px] text-ink whitespace-pre-wrap">{m.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
