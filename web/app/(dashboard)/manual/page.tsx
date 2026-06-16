/**
 * (dashboard)/manual/page.tsx — In-app operator user manual.
 *
 * Inputs:  none (static content; mirrors docs/guides/user-manual.md)
 * Outputs: a styled, sectioned manual with a sticky in-page table of contents,
 *          using the app's design tokens so it matches the dashboard.
 * Used by: route "/manual" (linked from the SideNav "Resources" footer)
 */

import Link from "next/link";
import { BookOpen, ExternalLink, ArrowDown } from "lucide-react";

export const metadata = {
  title: "User Manual — LeadGen Ops",
};

type TocItem = { id: string; label: string };

const TOC: TocItem[] = [
  { id: "overview", label: "What this app does" },
  { id: "daily-flow", label: "Daily workflow" },
  { id: "pages", label: "The dashboard, page by page" },
  { id: "tasks", label: "Core tasks, step by step" },
  { id: "lifecycle", label: "The lead lifecycle" },
  { id: "costs", label: "Costs & limits" },
  { id: "help", label: "Troubleshooting & help" },
];

const PAGES: { group: string; rows: { name: string; what: string }[] }[] = [
  {
    group: "Overview",
    rows: [
      { name: "Today", what: "Your home base. A “needs you” card (replies, missing emails, meetings, active batches) plus key metric cards. Every card is clickable and filters to the matching leads." },
      { name: "Analytics", what: "The “are we winning?” view. The number that matters is cost per finished lead — the go/stop signal — alongside the funnel and conversion rates." },
      { name: "Status", what: "A plain-English activity summary for a week, month, or year." },
    ],
  },
  {
    group: "Pipeline",
    rows: [
      { name: "Batches", what: "The raw scrapes — where leads come from. Re-run or export a batch; open one to see its stats, the stage funnel, and why any leads were filtered out." },
      { name: "Leads", what: "Every lead across all batches, searchable and filterable by stage, email status, and verification status." },
    ],
  },
  {
    group: "Outreach",
    rows: [
      { name: "Campaigns", what: "Bulk outreach jobs. Build a list, pick a channel (email / SMS / DM) and a schedule, launch, and watch contacted / interested / success rate." },
      { name: "Inbox", what: "People to follow up with — email replies and form submissions. “Sync replies” pulls new mail; open a conversation to read the thread and reply." },
      { name: "Email", what: "Your sending mailboxes. Connect a Bluehost/Titan inbox, test it, and watch warm-up." },
      { name: "Social", what: "The manual-DM worklist for Facebook/Instagram leads — copy the message, open the profile, send it yourself, mark it sent." },
    ],
  },
];

const TASKS: { title: string; steps: string[]; note?: string }[] = [
  {
    title: "Run a scraping batch",
    steps: [
      "Click + New batch (on Today or Batches).",
      "Pick the niche, country, and city. Use “Suggest best market” for a high-yield city.",
      "Choose the scraper — Apify is the default (Google Places / Outscraper are alternatives) — and a limit.",
      "Check the live cost preview, then Create batch — it queues and runs.",
      "Watch the status on the Batches list: queued → running → done (or failed).",
    ],
  },
  {
    title: "Build a demo site for a lead",
    steps: [
      "Open the lead. The dark Next Step banner will say “Build this lead’s demo site.”",
      "Click Build website — it runs enrich → generate → deploy (~30–90s).",
      "When it finishes, the lead gets a demo URL you can open and share.",
    ],
    note: "Building is gated to focus niches with a polished template; others use the general trades template.",
  },
  {
    title: "Connect a sending mailbox",
    steps: [
      "Email → + Connect mailbox.",
      "Enter the address, password, and (if needed) SMTP/IMAP host + ports. Defaults target Titan/Bluehost.",
      "The app verifies the connection and starts warm-up. Test it to confirm sending works.",
    ],
    note: "A one-time setup, and only for the email channel — SMS and DM don't need a mailbox.",
  },
  {
    title: "Verify email addresses",
    steps: [
      "On Leads, use the Verify filter and the Verify leads button for a batch check.",
      "On a single lead, Reverify re-checks an email you changed — status shows valid / invalid / catch-all.",
    ],
    note: "Only matters for the email channel — it stops you emailing dead addresses. Leads with no email are reached by SMS or DM instead, so a missing email is never a dead end.",
  },
  {
    title: "Send outreach",
    steps: [
      "Pick the channel that fits the lead — you don't need an email to reach one.",
      "Email: on the lead, click Send outreach (needs an email). Use Enroll to start the 4-step sequence.",
      "SMS: Text link sends a one-time form link (once the SMS provider is connected).",
      "DM: for social-only leads, use the Social page — copy, open profile, send, mark sent.",
    ],
    note: "Email is one of three channels. No-website leads are typically reached by SMS or a DM — so a lead without an email still gets worked.",
  },
  {
    title: "Run a campaign",
    steps: [
      "Campaigns → + New campaign.",
      "Source: from the database (filter by niche/city/segment), a CSV upload, or manual entry.",
      "Audience: channel (email/SMS/DM) + segment + filters. The preview shows how many match and a sample.",
      "Timing: which days and hours to send, plus timezone.",
      "Review → Create. For email, Test send to yourself first, then Launch (respects the daily cap + warm-up). Pause/Resume anytime.",
    ],
  },
  {
    title: "Work the inbox",
    steps: [
      "Open Inbox and click a conversation.",
      "Read the thread; reply inline if needed.",
      "Decide: interested → open the lead and Mark meeting booked; not interested → Mark closed-lost or dead.",
    ],
  },
  {
    title: "Improve a site after a meeting",
    steps: [
      "On the lead (stage meeting done), click Open improve form.",
      "Add the customer’s real photos, copy, hours, and brand color, then submit.",
      "The site rebuilds with their content and the lead moves to improved.",
    ],
  },
  {
    title: "Hand over the domain",
    steps: [
      "On an improved lead, click Hand over domain.",
      "Choose Attach and enter the customer’s domain — the app adds it to our hosting and gives you the DNS records to send them.",
      "Once live on their domain, mark the lead closed — won.",
    ],
  },
];

const LIFECYCLE: { stage: string; meaning: string; next: string }[] = [
  { stage: "scraped", meaning: "Pulled from Google Maps", next: "Build the demo" },
  { stage: "enriched", meaning: "Brand color + email looked up", next: "Build the demo" },
  { stage: "generated", meaning: "AI copy written", next: "(auto) deploy" },
  { stage: "deployed", meaning: "Demo site is live", next: "Send outreach" },
  { stage: "needs_email", meaning: "Deployed but no email found", next: "Add an email, then outreach" },
  { stage: "outreached", meaning: "Demo link sent", next: "Wait for a reply" },
  { stage: "replied", meaning: "They responded", next: "Triage — book a meeting or close-lost" },
  { stage: "meeting_booked", meaning: "Call scheduled", next: "Have the call" },
  { stage: "meeting_done", meaning: "Call happened", next: "Improve the site with their content" },
  { stage: "improved", meaning: "Rebuilt with real content", next: "Hand over their domain" },
  { stage: "handed_over", meaning: "Live on their domain", next: "Mark closed-won" },
  { stage: "closed_won", meaning: "Deal closed ✅", next: "—" },
  { stage: "closed_lost / dead", meaning: "Not moving forward", next: "—" },
];

const TROUBLE: { symptom: string; check: string }[] = [
  { symptom: "Batch shows failed", check: "Open it — the per-lead “last error” explains why. Re-run after fixing." },
  { symptom: "Build spinner stuck", check: "Builds run in the background; refresh the lead. A persistent error shows in “last error.”" },
  { symptom: "All leads filtered out", check: "The batch detail shows the rejection breakdown (had a website, low rating, too few reviews, no phone, category mismatch). Adjust the niche/city and re-scrape." },
  { symptom: "Outreach won’t send", check: "Confirm a mailbox is connected and tested on the Email page, and that the lead has a valid email." },
  { symptom: "No replies syncing", check: "Click Sync replies in the Inbox; confirm the mailbox’s IMAP test passed." },
  { symptom: "“Supabase not configured”", check: "The deployment is missing its database keys — a setup/ops issue, not a data problem." },
];

function SectionHead({ n, id, children }: { n: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <span className="eyebrow text-ink-subtle">{n}</span>
      <h2 id={id} className="editorial-head text-ink text-[20px] sm:text-[22px] scroll-mt-24">
        {children}
      </h2>
    </div>
  );
}

export default function ManualPage() {
  return (
    <div className="max-w-6xl">
      <header className="mb-8">
        <p className="eyebrow mb-2 flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5" strokeWidth={2} /> Operator guide
        </p>
        <h1 className="editorial-head text-ink text-[26px] sm:text-[32px] md:text-[36px] leading-none">
          User Manual
        </h1>
        <p className="mt-4 text-[14px] sm:text-[15px] text-ink-muted leading-relaxed max-w-2xl">
          The runbook for running the lead-gen pipeline day to day — what each page does and how
          to do every core task. For the developer-facing API, see the{" "}
          <Link href="/api-docs" className="text-action hover:underline">
            API reference
          </Link>
          .
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-8 lg:gap-12">
        {/* Content */}
        <div className="min-w-0 space-y-12 order-2 lg:order-1">
          {/* 1 — Overview */}
          <section>
            <SectionHead n="01" id="overview">What this app does</SectionHead>
            <div className="card p-5 sm:p-6 space-y-3 text-[14px] text-ink leading-relaxed">
              <p>
                It turns a <strong>city + business type</strong> into paying website-hosting
                clients, end to end: scrape local businesses from Google Maps, sort them by what
                they need, auto-build a personalized demo site for the good prospects, reach out by
                email / SMS / DM with the link, and close the ones who reply.
              </p>
              <p className="text-ink-muted">
                Generation costs pennies; a close is worth a setup fee plus monthly hosting. The
                whole point of the dashboard is that you’re never guessing what to do next — every
                lead shows its current stage and the one action that moves it forward.
              </p>
            </div>
          </section>

          {/* 2 — Daily flow */}
          <section>
            <SectionHead n="02" id="daily-flow">The daily workflow at a glance</SectionHead>
            <div className="card p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2 mb-5">
                {["Scrape", "Build", "Reach out", "Reply", "Meeting", "Improve", "Hand over", "Won"].map(
                  (step, i, arr) => (
                    <span key={step} className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-md bg-surface-alt px-2.5 py-1 text-[12px] font-semibold text-ink">
                        {step}
                      </span>
                      {i < arr.length - 1 && <span className="text-ink-subtle" aria-hidden>→</span>}
                    </span>
                  ),
                )}
              </div>
              <p className="eyebrow mb-3">A normal day</p>
              <ol className="space-y-2.5 text-[14px] text-ink leading-relaxed list-none">
                {[
                  "Open Today — it shows what needs you: replies waiting, leads blocked on a missing email, meetings booked, batches still running.",
                  "Clear the Inbox — read replies, decide yes/no, book meetings.",
                  "Work any new batch results — build demos, send outreach.",
                  "Glance at Analytics to confirm the numbers are healthy (cost per finished lead).",
                ].map((line, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mono-num text-ink-subtle text-[13px] mt-0.5">{i + 1}</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* 3 — Pages */}
          <section>
            <SectionHead n="03" id="pages">The dashboard, page by page</SectionHead>
            <div className="space-y-5">
              {PAGES.map((g) => (
                <div key={g.group} className="card overflow-hidden">
                  <div className="px-5 py-2.5 bg-surface-alt border-b border-rule">
                    <span className="eyebrow">{g.group}</span>
                  </div>
                  <table className="w-full text-[13.5px]">
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.name} className="border-b border-rule last:border-0 align-top">
                          <td className="px-5 py-3 font-semibold text-ink whitespace-nowrap w-28">
                            {r.name}
                          </td>
                          <td className="px-5 py-3 text-ink-muted leading-relaxed">{r.what}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>

          {/* 4 — Core tasks */}
          <section>
            <SectionHead n="04" id="tasks">Core tasks, step by step</SectionHead>
            <p className="-mt-2 mb-5 text-[13px] text-ink-muted">
              The steps run in order — each one leads to the next.
            </p>
            <div className="space-y-0">
              {TASKS.map((t, idx) => (
                <div key={t.title}>
                  <div className="card p-5 flex gap-4">
                    <span className="flex-shrink-0 h-7 w-7 rounded-full bg-ink text-canvas flex items-center justify-center font-display font-semibold text-[13px] leading-none">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display font-semibold text-ink text-[15px] mb-3">{t.title}</h3>
                      <ol className="space-y-2 text-[13px] text-ink-muted leading-relaxed">
                        {t.steps.map((s, i) => (
                          <li key={i} className="flex gap-2.5">
                            <span className="mono-num text-action text-[12px] mt-0.5 font-semibold">{i + 1}</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ol>
                      {t.note && (
                        <p className="mt-3 pt-3 border-t border-rule text-[12px] text-ink-subtle leading-relaxed">
                          {t.note}
                        </p>
                      )}
                    </div>
                  </div>
                  {idx < TASKS.length - 1 && (
                    <div className="flex justify-center py-1.5" aria-hidden>
                      <ArrowDown className="h-4 w-4 text-ink-subtle" strokeWidth={2} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 5 — Lifecycle */}
          <section>
            <SectionHead n="05" id="lifecycle">The lead lifecycle</SectionHead>
            <div className="card overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-surface-alt border-b border-rule text-left">
                    <th className="px-5 py-2.5 eyebrow font-semibold">Stage</th>
                    <th className="px-5 py-2.5 eyebrow font-semibold">Meaning</th>
                    <th className="px-5 py-2.5 eyebrow font-semibold">Your next move</th>
                  </tr>
                </thead>
                <tbody>
                  {LIFECYCLE.map((s) => (
                    <tr key={s.stage} className="border-b border-rule last:border-0 align-top">
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <code className="mono-num text-[12px] bg-surface-alt px-1.5 py-0.5 rounded text-ink">
                          {s.stage}
                        </code>
                      </td>
                      <td className="px-5 py-2.5 text-ink-muted">{s.meaning}</td>
                      <td className="px-5 py-2.5 text-ink">{s.next}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 6 — Costs & limits */}
          <section>
            <SectionHead n="06" id="costs">Costs & limits</SectionHead>
            <div className="card p-5 sm:p-6">
              <ul className="space-y-3 text-[14px] text-ink leading-relaxed">
                {[
                  ["Spend cap", "Today warns you as weekly spend approaches the monthly cap. Watch it."],
                  ["Scraper cost", "Apify is the default — it pulls Google Maps listings plus emails and social links in one pass at roughly $2 per 1,000 leads, billed on your Apify account (no hard per-query cap; a 300 safety cap applies). Google Places and Outscraper are alternatives (Places caps at 60 results/query, Outscraper at 500)."],
                  ["AI copy (Gemini)", "Free up to ~1,500 requests/day."],
                  ["Google’s $200/mo credit", "Only applies if you switch the scraper to Google Places — not to the default Apify path."],
                  ["Email warm-up", "New mailboxes ramp volume slowly for 2–3 weeks before full cold sending — this protects your domain reputation. The daily cap rises automatically as warm-up progresses."],
                  ["Paid actions", "Scraping, building (AI + deploy), and sending email/SMS cost money. The app shows previews; don’t bulk-run them without a glance at cost."],
                ].map(([k, v]) => (
                  <li key={k} className="flex gap-3">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>
                      <strong>{k}:</strong> <span className="text-ink-muted">{v}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* 7 — Help */}
          <section>
            <SectionHead n="07" id="help">Troubleshooting & help</SectionHead>
            <div className="card overflow-hidden">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-surface-alt border-b border-rule text-left">
                    <th className="px-5 py-2.5 eyebrow font-semibold w-56">Symptom</th>
                    <th className="px-5 py-2.5 eyebrow font-semibold">What to check</th>
                  </tr>
                </thead>
                <tbody>
                  {TROUBLE.map((t) => (
                    <tr key={t.symptom} className="border-b border-rule last:border-0 align-top">
                      <td className="px-5 py-3 font-semibold text-ink">{t.symptom}</td>
                      <td className="px-5 py-3 text-ink-muted leading-relaxed">{t.check}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 card p-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13.5px] text-ink-muted">
                Need a human? Use the <strong className="text-ink">Support</strong> link in the
                sidebar. For how the system is built, see the developer docs and the API reference.
              </p>
              <Link href="/api-docs" className="btn btn-secondary btn-sm">
                API reference <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </section>
        </div>

        {/* Sticky table of contents */}
        <aside className="order-1 lg:order-2">
          <nav className="lg:sticky lg:top-20">
            <p className="eyebrow mb-3">On this page</p>
            <ul className="space-y-1.5 border-l border-rule">
              {TOC.map((item, i) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="flex items-baseline gap-2 -ml-px border-l border-transparent hover:border-action pl-3 py-0.5 text-[13px] text-ink-muted hover:text-ink transition-colors"
                  >
                    <span className="mono-num text-[11px] text-ink-subtle">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{item.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </div>
  );
}
