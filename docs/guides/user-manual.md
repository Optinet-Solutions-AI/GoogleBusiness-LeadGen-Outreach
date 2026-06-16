# User Manual

> The operator's runbook for the Local Lead-Gen & Auto-Site dashboard.
> Plain language, task-first. If you run the app day-to-day, this is your guide.
> A live, in-app version is at **/manual**; the developer API reference is at **/api-docs**.

---

## 1. What this app does

It turns a **city + business type** into paying website-hosting clients, end to end:

1. **Scrape** local businesses from Google Maps (a *batch*).
2. **Sort** each business by what it needs — no website, weak website, or good website.
3. **Build** a personalized demo website for the good prospects, automatically.
4. **Reach out** by email, SMS, or DM with a link to their demo.
5. **Close** the ones who reply — book a meeting, swap in their real photos/copy, point their
   own domain at the site, and start charging.

Generation cost per site is pennies; a close is worth a setup fee plus monthly hosting. The
whole point of the dashboard is that **you're never guessing what to do next** — every lead
tells you its current stage and the one action that moves it forward.

---

## 2. The daily workflow at a glance

```
Scrape  →  Build  →  Reach out  →  Reply  →  Meeting  →  Improve  →  Hand over  →  Won
(batch)   (demo)    (email/SMS/DM)         (book/done)   (real      (their           ($$$)
                                                          content)   domain)
```

A normal day:

1. Open **Today**. It shows what needs you — replies waiting, leads blocked on a missing
   email, meetings booked, batches still running.
2. Clear the **Inbox** — read replies, decide yes/no, book meetings.
3. Work any **new batch** results — build demos, send outreach.
4. Glance at **Analytics** to see whether the numbers are healthy (cost per finished lead).

---

## 3. The dashboard, page by page

The left sidebar is grouped into **Overview**, **Pipeline**, and **Outreach**.

### Overview

| Page | What it's for |
|------|---------------|
| **Today** | Your home base. "Needs you" card (replies, missing emails, meetings, active batches) + key metric cards (sites this week, finished, closed/MRR, spend vs. cap, pipeline value) + a recent-activity feed. Every card is clickable and filters you to the matching leads. |
| **Analytics** | The "are we winning?" view. The number that matters is **cost per finished lead** — the go/stop signal. Also shows the funnel (leads → contacted → clicked → finished) and conversion rates. |
| **Status** | A plain-English activity summary for a week / month / year ("3 batches run, 42 leads scraped, 28 sites deployed, 12 replies"). |

### Pipeline

| Page | What it's for |
|------|---------------|
| **Batches** | The raw scrapes — where leads come from. Each row shows niche, city, scraper, status, and lets you re-run or export. Open one to see its stats, the stage funnel, the qualified leads, and (if everything was filtered out) *why*. |
| **Leads** | Every lead across all batches, searchable and filterable by stage, email status, and verification status. Click any lead to open its detail page. |

### Outreach

| Page | What it's for |
|------|---------------|
| **Campaigns** | Bulk outreach jobs. Build a list (by niche/city/segment, CSV, or by hand), pick a channel (email / SMS / DM) and a sending schedule, then launch and watch contacted / interested / success-rate. |
| **Inbox** | People to follow up with — email replies and form submissions. "Sync replies" pulls new mail. Open a conversation to read the full thread and reply. |
| **Email** | Your sending mailboxes. Connect a Bluehost/Titan inbox, test it, and watch its warm-up status. |
| **Social** | The manual-DM worklist for Facebook/Instagram leads. Copy the message, open the profile, send it yourself, then mark it sent. |

---

## 4. Core tasks, step by step

*These are in the order you'll actually do them.*

### Run a scraping batch
1. Click **+ New batch** (Today or Batches).
2. Pick the **niche**, **country**, and **city**. Use *Suggest best market* if you want a
   high-yield city for that niche.
3. Choose the **scraper** — **Apify** is the default (Google Places / Outscraper are alternatives) — and a **limit**.
4. Check the **live cost preview**, then **Create batch**. It queues and runs.
5. Watch the status on the Batches list: `queued → running → done` (or `failed`).

### Build a demo site for a lead
1. Open the lead. The dark **Next Step** banner will say "Build this lead's demo site."
2. Click **Build website**. It runs enrich → generate → deploy (~30–90s, with a spinner).
3. When it finishes, the lead gets a **demo URL** you can open and share.

> Building is gated to the focus niches that have a polished template. Other niches use the
> general trades template.

### Connect a sending mailbox  *(one-time · email channel only)*
1. **Email → + Connect mailbox.**
2. Enter the address, password, and (if needed) SMTP/IMAP host + ports. Defaults target
   Titan/Bluehost.
3. The app verifies the connection and starts warm-up. **Test** it to confirm sending works.

> SMS and DM don't need a mailbox — this step is only for the email channel.

### Verify email addresses  *(email channel only)*
- On **Leads**, use the **Verify** filter and the **Verify leads** button for a batch check.
- On a single lead, **Reverify** re-checks an email you changed. Status shows valid / invalid /
  catch-all so you only send to addresses likely to land.

> Verification only matters for the email channel. **Leads with no email aren't stuck** — you
> reach them by SMS or DM instead.

### Send outreach  *(pick the channel that fits the lead)*
- **Email:** on the lead, click **Send outreach** (needs an email). For a sequence, use
  **Enroll** to start the 4-step progressive-trust emails.
- **SMS:** **Text link** sends a one-time form link (once the SMS provider is connected).
- **DM:** for social-only leads, use the **Social** page — copy, open profile, send, mark sent.

> Email is one of **three** channels. A lead without an email is normal — no-website leads are
> typically worked by SMS or a DM.

### Run a campaign
1. **Campaigns → + New campaign.**
2. **Source:** from the database (filter by niche/city/segment), a CSV upload, or manual entry.
3. **Audience:** channel (email/SMS/DM) + segment + any filters. The preview shows how many
   leads match and a sample of them.
4. **Timing:** which days and hours to send, plus timezone.
5. **Review → Create.** For email, **Test send** one to yourself first, then **Launch**.
   Sending respects the daily cap and warm-up ramp; you can **Pause/Resume** anytime.

### Work the inbox
1. Open **Inbox** and click a conversation.
2. Read the thread. Reply inline if you need to.
3. Decide: interested → open the lead and **Mark meeting booked**; not interested → **Mark
   closed-lost** or **dead**.

### Improve a site after a meeting
1. On the lead (stage *meeting done*), click **Open improve form**.
2. Add the customer's real **photos, copy, hours, and brand color**, then submit.
3. The site rebuilds with their content and the lead moves to *improved*.

### Hand over the domain
1. On an *improved* lead, click **Hand over domain**.
2. Choose **Attach** and enter the customer's domain — the app adds it to our hosting and gives
   you the DNS records to send them. (Or **Transfer** to record a manual handoff.)
3. Once live on their domain, mark the lead **closed — won**.

---

## 5. The lead lifecycle (what each stage means)

| Stage | Meaning | Your next move |
|-------|---------|----------------|
| `scraped` | Pulled from Google Maps | Build the demo |
| `enriched` | Brand color + email looked up | Build the demo |
| `generated` | AI copy written | (auto) deploy |
| `deployed` | Demo site is live | Send outreach |
| `needs_email` | Deployed but no email found | Add an email, then outreach |
| `outreached` | Demo link sent | Wait for a reply |
| `replied` | They responded | Triage — book a meeting or close-lost |
| `meeting_booked` | Call scheduled | Have the call |
| `meeting_done` | Call happened | Improve the site with their content |
| `improved` | Rebuilt with real content | Hand over their domain |
| `handed_over` | Live on their domain | Mark closed-won |
| `closed_won` | Deal closed ✅ | — |
| `closed_lost` / `dead` | Not moving forward | — |

---

## 6. Costs & limits (plain English)

- **Spend cap:** Today warns you as weekly spend approaches the monthly cap. Watch it.
- **Scraper cost:** **Apify is the default** — it pulls Google Maps listings *plus* emails and
  social links in one pass at roughly **$2 per 1,000** leads, billed on your Apify account (no
  hard per-query cap; we apply a 300 safety cap). Google Places and Outscraper are alternatives
  (Places caps at **60** results per query, Outscraper at **500**).
- **AI copy (Gemini):** free up to ~1,500 requests/day.
- **Google's $200/mo credit:** only relevant if you switch the scraper to **Google Places** —
  it doesn't apply to the default Apify path.
- **Email warm-up:** new mailboxes ramp volume slowly for 2–3 weeks before full cold sending —
  this protects your domain's reputation. The daily cap rises automatically as warm-up
  progresses.
- **Paid actions:** scraping, building (AI + deploy), and sending email/SMS cost money. The app
  shows previews; don't bulk-run them without a glance at cost.

---

## 7. Troubleshooting & help

| Symptom | What to check |
|---------|---------------|
| Batch shows **failed** | Open it — the per-lead "last error" explains why. Re-run after fixing. |
| Build **spinner stuck** | Builds run in the background; refresh the lead. A persistent error shows in "last error." |
| **All leads filtered out** | The batch detail shows the rejection breakdown (had a website, low rating, too few reviews, no phone, category mismatch). Adjust the niche/city and re-scrape. |
| Outreach **won't send** | Confirm a mailbox is connected and tested on the **Email** page, and that the lead has a valid email. |
| **No replies syncing** | Click **Sync replies** in the Inbox; confirm the mailbox's IMAP test passed. |
| "**Supabase not configured**" | The deployment is missing its database keys — a setup/ops issue, not a data problem. |

**Need a human?** Use the **Support** link in the sidebar (emails the operator). For how the
system is built, see the developer docs in `docs/` and the **API reference** at `/api-docs`.
