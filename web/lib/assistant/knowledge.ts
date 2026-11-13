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
  "How do I email or call one lead?",
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
- [Leads](/leads) — every lead from every batch in one list. The **Contact** column shows email + its status, phone
  and the owner. The **Reach out** column has three small buttons per lead: Send email, Call with AI, Find contacts
  (AI). Send email and Call with AI always open a preview first; nothing goes out until you confirm there. Tick
  several leads for the bulk bar: **Find contacts (AI)** (up to 25), **Email selected** (up to 50), **Call selected** (up to 25),
  **Build demos**, **Add to campaign**. Filters: Stage, Email (has / none), Email status (Ready to send / Not checked
  / Bad address), Lead type (closing / exhibitor). Click a row to open the lead page.
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

1. **Create a batch.** Click **+ New batch** (on [Today](/) or [Batches](/batches)). First choose what you are
   looking for: **Local businesses** (Google Maps), **Closing businesses** (US notices) or **Conference exhibitors**
   (Europe). For local businesses pick the category and niche (e.g. Home Services → locksmith), the country and
   city, and a limit. Check the cost shown, then click **Find leads**. The batch runs in the background (a few
   minutes). It only finds and researches leads; it never builds or emails on its own.
2. **See the leads.** Open the batch from [Batches](/batches): its "Qualified" table lists the leads it found.
   The same leads are also in [Leads](/leads) (filter by that batch) and in the "Not contacted" column of [CRM](/crm).
   You do not need to go back and forth: open the batch once, then click each lead in its table.
3. **Review a lead.** The lead page shows the business, then a **Contact** card: phone (tap to call), email with its
   status in words (Ready to send / Not checked / Bad address / Catch-all / No email), the owner or contact person,
   their contact page and "where this came from". The dark **Next step** banner at the top always says the one
   action that moves this lead forward.
   The Contact card has three buttons: **Send email** (the Send email window: pick what you're offering, check the
   ready-made email, optionally add follow-ups, send; see "Sending an email" below), **Call with AI** (opens the call
   preview, then queues an AI phone call; the number is editable for a test) and **Find contacts (AI)** (OpenAI web
   search + their website: email, phone, owner; about 3 cents).
4. **Act on the lead.** Depending on the offer:
   - Needs a website (no website or an old one): optionally click **Build website** first (about 1–2 minutes, gives
     a live demo link). Then **Send email** with "New website" or "Website redesign": the demo link is put in the
     email when there is one; without one the email offers to make them a sample.
   - Has a good website: offer AI services (AI voice agent, AI booking) or SEO from the Send email list. You can still
     Build a site manually.
   - Exhibitor or closure lead: no website. Send email opens with the stand / inventory offer, or add the lead to an
     AI-call campaign.
5. **Make it a client** when they say yes (or earlier, if you want to prepare their brand): on the lead page click
   **Make client**. That creates the client with the lead's website, demo site and socials attached as sources.
   Then **Open client** → **Build Brand Brain** → Posts tab for social content. Making a client does not send
   anything and is not needed to build a website.
6. **Follow up.** Replies land in [Inbox](/inbox). Mark meeting booked / done on the lead (or drag in [CRM](/crm)).
   Then **Mark closed — won** (or lost). The old Rebuild site, Improve form and Hand over panels were removed from the
   lead page.

## Batch sources (the first choice in the New batch form: "What are you looking for?")

- **Local businesses** — Google Maps. Pick category + niche, country, city. The data provider sits in a collapsed
  "Data provider" row: **Apify** (default, about $3–4 per 1,000, cap 300), **Google Places** (cap 60) or
  **Outscraper** (cap 500). Only this source shows the niche, city and design fields.
- **Closing businesses** — US notices, free. Pick which notices: Closures / Closures + layoffs (WARN notices) or
  Bankruptcies / Bankruptcies + closures (SEC filings), then the state and the time window. For the "we buy your
  inventory" offer. Never a website.
- **Conference exhibitors** — companies that had a stand (booth) at a conference or trade show in Europe. For the
  booth-building offer. Pick the conference category (iGaming, gaming, technology, fintech, food, marketing, health,
  real estate, any), where (one country or all of Europe), the year, and optionally paste conference links (one per
  line: the exhibitors page or the ExpoFP floor plan, an address ending in expofp.com). Leave links blank and the
  system finds the shows itself with OpenAI web search (about 5–10 cents). Exhibitors are read from the public floor
  plan or the exhibitors page. Sites that block automated visitors are skipped, never forced; paste the floor-plan
  link instead. Every lead is a company with a stand at that show (the show, dates and stand number are on the lead).
  Contact details come from AI research first, then the company's own site. About 1–3 cents per lead.
  Never a website.

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

## Sending an email (the Send email window)

Opened by **Send email** on the lead's Contact card, the Next step banner, or the envelope button on a Leads list row.
- **To** with the address status, and **From**: pick the mailbox.
- **What are you offering?** New website, Website redesign, AI voice agent (answers their calls), AI booking /
  calendar agent, SEO, We buy their inventory (closing business), Exhibition stand (trade-show exhibitor), or Write
  my own. The one that fits the lead is picked for you, marked "(fits this lead)". Picking a service fills in a
  ready-made email with the business name, the owner's first name when known, the city, the demo link (website
  emails, when a demo exists) and your name. Edit anything; it is sent exactly as written.
- **Follow-ups if they don't reply:** None (default), 1 (day 4) or 2 (day 4 and day 8). Each is pre-written and
  editable, and goes from the same mailbox as a reply ("Re: <subject>"). They stop by themselves on a reply, a bounce
  or an unsubscribe. The lead page then shows a "Follow-up emails" card with Stop follow-ups.
- The first email goes right away. A never-checked address is checked first (under 1 cent); unsubscribed or bad
  addresses are never emailed. Replies land in the Inbox.

## Emails

- All email goes out through Ongage, from a connected mailbox address ([Email](/email-accounts)). Replies are read
  from that mailbox.
- Only verified addresses are emailed (valid or catch-all). Send email checks a never-checked address first. Use
  **Verify emails** on [Leads](/leads) for many at once, or **Re-verify email** on one lead after editing its email.
- "The email checker is out of credits (ZeroBounce)": the paid checker has run out. Hunter (the backup) still checks
  most addresses; top up ZeroBounce to check the rest. "Couldn't confirm this address": neither checker could say
  the mailbox exists; find another address.
- An AI-call campaign cannot call leads in Malta, the UK, Ireland, Germany, France, Spain, Italy, Portugal, the
  Netherlands, Sweden, Norway, Poland or Greece (GDPR rule); email them instead.
- Follow-ups and the classic sequence stop by themselves on a reply, a bounce or an unsubscribe.
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
- On any lead, click **Find contacts (AI)** (Contact card, or the sparkle button in the Leads list): OpenAI web search
  plus their website, about 3 cents, 10–40 seconds. It fills in email, phone, owner and sources when it finds them
  and never overwrites what is already there. Results are from public pages and are good enough to use; the
  sources are listed under "where this came from".
- Or type an email in by hand (pencil icon on the Contact card); it is checked when you send.
- No email is not a dead end: **Call with AI**, or DM them from [Social](/social).

## The classic sequence preview (Email selected, several leads)

**Email selected** on [Leads](/leads) (several leads at once) opens the classic 4-email sequence preview. (One lead:
use the Send email window above.) It shows:
- **To** (with the address status), **From** (the mailbox, or the ones it rotates between), **When** it goes out
  (within ~15 minutes in sending hours, otherwise the next opening, in the lead's time) and the **Pitch**.
- **The first email, editable.** Change the subject or any word. It is sent exactly as shown; **Back to our
  wording** undoes edits. A blank line starts a new paragraph. {{demo_link}} becomes the live link.
- If the business probably speaks another language: **Translate to …** puts the translation in the box for you to
  read before sending. Otherwise the first email goes in English as shown.
- **Then, if they don't reply:** the follow-ups (day 4 with the screenshot, day 8 with the link, day 12 soft close),
  read-only. Follow-ups use the standard wording and are translated when sent.
- A spam-filter warning appears under the email if the wording looks risky.
Press **Send first email** (or **Send to N** for several leads; untick any you want to skip). A never-checked
address is checked first (under 1 cent).
**No demo built yet?** You can still send. A lead with no website (or a weak one) and no demo gets a short 2-email
version: the first offers to make them a free sample site, the second is one soft follow-up 4 days later. No
screenshot, no link. Build the demo first if you want the full 4-email version with the screenshot and live link.
Good-website leads always get the 2-email AI-services pitch, no demo needed.

## AI phone calls (Voizo)

- **One lead:** click **Call with AI** on the lead's Contact card, or the phone button in the Leads list. A preview
  opens first: the number it will dial and the **name it greets them by** (pre-filled with the owner's first name;
  edit it, or leave it empty and the agent uses no name). Press **Queue the call**.
- **Test the agent on yourself:** change the number in the preview to your own (with the country code, e.g.
  +1 512 555 0123). Only that call goes to it; the lead's saved number is not changed, and the result is saved on the
  lead. Works on a lead with no phone too, and can be repeated. The lead's country rules still apply (GDPR countries
  are never called), so test with a lead from an allowed country such as the US. The lead
  joins the standing "Quick calls (AI) · <country>" campaign and the AI calls within about 15 minutes, between 9:00
  and 20:00 in the lead's country time. The button says why when a lead can't be called (no phone, GDPR country,
  asked not to be called, wrong number, already interested).
- **Many leads:** tick them in [Leads](/leads) → **Call selected**. Or [Campaigns](/campaigns) → **+ New campaign**
  → channel **AI call** → pick leads, days and hours → **Activate**, when you want your own schedule.
- Every 15 minutes the system calls one lead at a time, up to 100 a day, inside the campaign's hours.
- Results land on the lead and its CRM timeline: interested (goes to [Inbox](/inbox) for a person to follow up),
  not interested, no answer (retried later), wrong number (never called again).
What the AI agent says is ONE fixed script set inside the Voizo app, the same for every lead. The agent is given only
the phone number and the greeting name. It does NOT know the business name, our offer, the demo site or their
website; the call preview says so. To change what it says, edit the script in Voizo. Leads in GDPR countries (Malta,
UK, most of the EU) are not called.

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
