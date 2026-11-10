/**
 * assistant/knowledge.ts — what the in-app assistant knows: a plain operator guide to the RateUp app.
 *
 * Inputs:  none (static text)
 * Outputs: SYSTEM_GUIDE (sent to the model as its only source of truth), SUGGESTED_QUESTIONS (chips in the panel)
 * Used by: lib/assistant/prompt.ts, components/assistant/AssistantWidget.tsx
 *
 * Keep this in step with the app: when a page, button or rule changes, change the line here too.
 * Links use real app paths ([Leads](/leads)) so the panel can turn them into clickable links.
 */

export const SUGGESTED_QUESTIONS: string[] = [
  "What is the fastest way from a new batch to a client?",
  "How do I build a website for a lead?",
  "How do I find companies exhibiting at iGaming conferences?",
  "A lead has no email. What can I do?",
  "How do I start AI phone calls?",
  "What should I do on this page?",
];

export const SYSTEM_GUIDE = `
# RateUp app — operator guide

RateUp turns "a type of business + a place" into paying clients. It finds businesses (Google Maps, conference
exhibitor lists, closure notices), sorts them by what they need, builds a free demo website for the ones that need
one, reaches out (email sequence, AI phone calls), and tracks every deal to "won".

## The pages (left sidebar)

Overview
- [Today](/) — home. The "Needs you" card lists what waits on a person: replies, leads missing an email, meetings,
  running batches. Every card is clickable.
- [Analytics](/analytics) — funnel, conversion rates, cost per finished lead.
- [Revenue](/revenue) — setup fees and monthly hosting from won clients.
- [Status](/status) — plain-English activity summary for a week, month or year.

Pipeline
- [Batches](/batches) — every search you ran ("batch"), with status (queued, running, done, failed, paused, cancelled)
  and cost. Open a batch to see its leads: a "Qualified" table and a "Rejected" table with the reason.
- [Leads](/leads) — every lead from every batch in one list. Search and filter by batch, stage, email, verification.
  Click a row to open the lead page.
- [CRM](/crm) — the deal board. One column per sales stage; drag a card to move it. Click a card for the side panel:
  phone, email, offer, demo link, timeline of emails / calls / stage changes / notes, next follow-up date, owner, tags.
  The strip on top shows follow-ups overdue / today / this week. Dragging never sends anything, it only records.

Clients
- [Clients](/clients) — businesses you work with. Each client has a Brand Brain (a sourced profile of the business),
  products, images, and a Posts tab (Creative Studio) for social posts and Reels.
- [Ad Library](/ads) — competitors' image and video ads pulled from the Meta Ad Library. Save the good ones, then
  "Make our version" turns one into a draft post + video script for a client. It never copies their media or words.

Outreach
- [Campaigns](/campaigns) — bulk outreach. Channels: Email, SMS (not switched on yet), DM, and AI call.
- [Inbox](/inbox) — replies and form submissions to follow up. "Sync replies" pulls new mail.
- [Email](/email-accounts) — the sending mailboxes (connect, **Send test**, warm-up caps).
- [Social](/social) — manual Facebook / Instagram DM worklist.

Resources (bottom of the sidebar): [User manual](/manual).

## The main path: batch → leads → client → website / outreach

1. **Create a batch.** Click **+ New batch** (on [Today](/) or [Batches](/batches)). Pick the source, the niche
   (e.g. plumbers, dentists), the country and city, and a limit. Check the cost shown, then create it. The batch
   runs in the background (a few minutes). It only finds and enriches leads; it never builds or emails on its own.
2. **See the leads.** Open the batch from [Batches](/batches): its "Qualified" table lists the leads it found.
   The same leads are also in [Leads](/leads) (filter by that batch) and in the "Not contacted" column of [CRM](/crm).
   You do not need to go back and forth: open the batch once, then click each lead in its table.
3. **Review a lead.** The lead page shows the business, phone, email, website verdict, segment and offer.
   The dark **Next step** banner at the top always says the one action that moves this lead forward.
4. **Act on the lead.** Depending on the offer:
   - Needs a website (no website or an old one): click **Build website**. It takes about 1–2 minutes and gives the
     lead a live demo link plus a screenshot. Then click **Enroll in sequence** to start the email ladder.
   - Has a good website: the offer is AI services (booking, AI receptionist). You can still Build a site manually.
   - Exhibitor or closure lead: no website. Send the email from the lead page or add it to an AI-call campaign.
5. **Make it a client** when they say yes (or earlier, if you want to prepare their brand): on the lead page click
   **Make client**. That creates the client with the lead's website, demo site and socials attached as sources.
   Then **Open client** → **Build Brand Brain** → Posts tab for social content. Making a client does not send
   anything and is not needed to build a website.
6. **Follow up.** Replies land in [Inbox](/inbox). Mark meeting booked / done on the lead (or drag in [CRM](/crm)).
   After the meeting: **Open improve form** (their real photos, copy, hours) → **Hand over domain** → **Mark closed — won**.

## Batch sources (in the New batch form, "Scraper provider")

- **Apify** (default) — Google Maps businesses. About $3–4 per 1,000. Cap 300 per search.
- **Google Cloud Places** — Google Maps via Google's API. Cap 60 per search.
- **Outscraper** — Google Maps, cap 500.
- **Conference exhibitors** — companies that had a stand (booth) at a conference or trade show in Europe. For the
  booth-building offer. Pick the conference category (iGaming, gaming, technology, fintech, food, marketing, health,
  real estate, any), where (one country or all of Europe), the year, and optionally paste conference links (one per
  line: the exhibitors page or the ExpoFP floor plan, an address ending in expofp.com). Leave links blank and the
  system finds the shows itself with OpenAI web search (about 5–10 cents). Exhibitors are read from the public floor
  plan or the exhibitors page. Sites that block automated visitors are skipped, never forced; paste the floor-plan
  link instead. Every lead is a company with a stand at that show (the show, dates and stand number are on the lead).
  Contact details come from AI research first, then the company's own site. About 1–3 cents per lead.
  Use the **Conference exhibitors** button itself; do not pick Apify after it (that would search Google Maps).
- **WARN closures** — US businesses that filed closure / layoff notices. Free. For the "we buy your inventory" offer.
- **SEC filings** — US companies with bankruptcy or facility-closure 8-K filings. Free. Same inventory offer.

## Segments and offers (decided automatically for each lead)

- **No website** → build a demo website, then the screenshot email sequence.
- **Old / weak website** → build a modern rebuild demo ("improve").
- **Good website** → do not pitch a website; offer AI services (AI booking, AI receptionist / phone, AI chat).
- **Closure / liquidation lead** → "we buy your remaining inventory" email or AI call. Never a website.
- **Conference exhibitor** → "we design and build exhibition stands" email (names the show and stand) or AI call.
  Never a website.
The **Build website** button is on every normal lead (any niche, even with a website). Five niches have their own
design (trades, dental, chiropractic, restaurant, auto); every other niche uses the general premium design.
Exhibitor and closure leads never have Build.

## Lead stages (in order)

scraped → enriched → generated → deployed → outreached → replied → meeting booked → meeting done → improved →
handed over → closed won (or closed lost / dead). "needs email" = the demo is ready but no email was found.

## Emails

- All email goes out through Ongage, from a connected mailbox address ([Email](/email-accounts)). Replies are read
  from that mailbox.
- **Enroll in sequence** (lead page) starts 4 emails, 4 days apart: Day 0 plain text, Day 4 with the demo screenshot,
  Day 8 with the live link, Day 12 a soft "should I take it down?" close. Sent automatically every 15 minutes.
- Only verified addresses are emailed (valid or catch-all). **Send outreach** / **Enroll in sequence** check a
  never-checked address automatically first. Use **Verify emails** on [Leads](/leads) for many at once, or
  **Re-verify email** on one lead after editing its email.
- **Send outreach** in the lead's Next step banner does the same thing as Enroll: it starts this sequence.
- An AI-call campaign cannot call leads in Malta, the UK, Ireland, Germany, France, Spain, Italy, Portugal, the
  Netherlands, Sweden, Norway, Poland or Greece (GDPR rule); email them instead.
- The sequence stops by itself on a reply, a bounce or an unsubscribe.
- New mailboxes warm up for 2–3 weeks; their daily cap rises by itself.
- For a bulk send use [Campaigns](/campaigns) → **+ New campaign** → channel Email → filters → schedule → review →
  **Launch** (it first sends a test to you, then starts on your confirmation). Pause / Resume any time.

## A lead has no email

- During a batch, AI research runs first on each lead (up to 100 per batch): OpenAI web search looks for the business
  email, phone, contact page and the owner's name and role, and keeps only what a public page shows. Then the free
  crawl of the business's own website fills gaps; an email on their own site wins over one from a directory.
- If OpenAI is unavailable (no key, key expired, no credit) an amber banner shows at the top of every page and in the
  New batch form, and the batch page says its leads were looked up with the free crawl only: expect fewer emails
  and no owner names. Ask the admin to fix the OpenAI key or credit.
- On the lead page you can type an email in by hand (**Add email**), then **Re-verify email**.
- No email is not a dead end: call the lead with an AI-call campaign, or DM them from [Social](/social).

## AI phone calls (Voizo)

1. [Campaigns](/campaigns) → **+ New campaign** → channel **AI call**.
2. Pick the leads (they need a phone number), set calling days and hours, review, then **Activate**.
3. Every 15 minutes the system calls one lead at a time, up to 100 a day, inside those hours.
4. Results land on the lead and its CRM timeline: interested (goes to [Inbox](/inbox) for a person to follow up),
   not interested, no answer (retried later), wrong number (never called again).
What the AI agent says is set inside the Voizo app. Leads in GDPR countries (Malta, UK, most of the EU) are not called.

## Clients, Brand Brain and Creative Studio

- **Make client** on a lead, or **New client** on [Clients](/clients).
- Client page → Overview / Brain / Products / Assets / Intake / Posts / History.
- Add sources (website, Facebook, Instagram, Google Maps, the intake form), then **Build Brand Brain**: the system
  reads them and writes a profile with the source of every fact. Later rebuilds come as a draft you accept, merge
  or discard.
- Posts tab → **Plan a month** (platforms, posts per week, products, AI backgrounds on/off) → review the proposed
  ideas → confirm the cost → posts are written and rendered in 3 sizes. Approve each post, then **Download pack**
  (images + captions file). Every claim is checked against the Brand Brain; a blocked claim must be fixed first.
- **Make a Reel** strings 2–12 approved posts into one vertical video (free, about a minute or two).

## Ad Library

[Ad Library](/ads) → **Pull ads** (a competitor's Facebook page or a keyword, country, how many; about $0.006 per ad)
→ browse → **Save** the useful ones (saving keeps a copy, since Meta links expire) → tag / note →
**Make our version** for a client: a draft post + a video script in the client's own brand, in Creative Studio.

## Costs (approximate)

Google Maps scrape $3–4 per 1,000 leads (Apify). Demo website about 5 cents. Email verification fractions of a cent.
AI research 1–3 cents per lead (up to 100 leads a batch; included in the batch cost estimate). Conference discovery 5–10 cents per batch. Creative Studio max $5 per month plan.
Ad pulls about $0.006 per ad. Reels free. Anything paid shows its cost before you confirm.

## Troubleshooting

- **Batch failed** — open it; the reason is shown in the red box on the batch page and on each lead ("last error"). Fix the cause, then
  **Re-run**. If the error mentions OpenAI ("API key expired" / "insufficient quota"), the OpenAI key needs replacing
  or topping up — ask the admin.
- **Build website did nothing** — wait 1–2 minutes and refresh. If the lead shows a "last error" or "skipped" note,
  it explains why (for example a missing niche: set the lead's niche, then Build again).
- **No Build button** — the lead is an exhibitor or closure lead (they never get a website).
- **Email won't send** — check a mailbox is connected and tested on [Email](/email-accounts), the lead has a verified
  email, and sending is not paused.
- **Replies not showing** — click **Sync replies** in [Inbox](/inbox).
- **A batch of junk results** — make sure the source button matches what you want (Google Maps vs Conference
  exhibitors vs WARN / SEC).
- **Assistant voice not working** — use Chrome. Allow the microphone when Chrome asks (choose "Allow on every visit").
  If you blocked it: click the icon left of the web address → Microphone → Allow, then reload.
`.trim();
