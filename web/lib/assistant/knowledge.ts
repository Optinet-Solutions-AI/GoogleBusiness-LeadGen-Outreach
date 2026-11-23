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
  and the owner. The **Reach out** column has three small buttons per lead: Send email, Call with AI, Research
  business (sparkle). Send email and Call with AI always open a window first; nothing goes out until you confirm there.
  Tick several leads for the bulk bar: **AI Lookup** (up to 25), **Call selected** (up to 25),
  **Build demos**, **Add to campaign**. Filters: Stage, Email (has / none), Email status (Ready to send / Not checked
  / Bad address), Lead type (closing / exhibitor). Click a row to open the lead page.
- [CRM](/crm) — the deal board. One column per sales stage; drag a card to move it. Click a card for the side panel:
  phone, email, offer, demo link, timeline of emails / calls / stage changes / notes, next follow-up date, owner, tags.
  The strip on top shows follow-ups overdue / today / this week. Dragging never sends anything, it only records.
  By default the board shows only leads someone reached (contacted, replied, meetings, won / lost); click **Show not
  contacted (N)** to add the "Not contacted" column (every scraped lead), **Hide not contacted** to remove it.

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
   The same leads are also in [Leads](/leads) (filter by that batch) and in the "Not contacted" column of [CRM](/crm)
   (hidden until you click Show not contacted). Once you email or call them they move to Contacted on the CRM.
   You do not need to go back and forth: open the batch once, then click each lead in its table.
3. **Review a lead.** The lead page shows the business, then a **Contact** card: phone (tap to call), email with its
   status in words (Ready to send / Not checked / Bad address / Catch-all / No email), the owner or contact person,
   their contact page and "where this came from". Below the Contact card is the Outreach log (every
   email and call). The right side has **Build website** (when a demo can be built), the **Website verdict** (what the
   audit found about their site, with the segment switch) and **Make client** (Brand Brain). (The Next step banner,
   journey bar, Stage timeline, Skip / Triage, Meeting, Close out, Billing and follow-up panels are hidden for now;
   move a lead's stage on the [CRM](/crm) board.) In the Batches and Leads tables, the business name opens the lead
   page; the small "Google ↗" link next to it opens the Google listing.
   The Contact card has three buttons: **Send email** (the Send email window: pick what you're offering, check the
   ready-made email, optionally add follow-ups, send; see "Sending an email" below), **Call with AI** (opens the call
   preview, then queues an AI phone call; the number is editable for a test), **AI Lookup** (OpenAI web search + a free scan of their own website, about 2–5 cents, up to a minute) and,
   when we know it, **Contact page** (opens the contact page on their website).
   **Train the voice agent**: in the Test voice agent window click **Train this agent** (that is the way in: the Voice agents
   page, which has a **Train an agent** button, is not in the menu). Type, or click the mic and speak (English or Hebrew, Chrome), what the
   agent should say differently, one thing at a time, e.g. "don't mention price on the first call". It answers in
   the same box and shows the lines it would change (says now → will say). Nothing changes until you press **Save
   change**; a saved change is used from the agent's next call, and **Undo** (or "Show recent changes") puts the old
   wording back. It can only reword what the agent already says; adding new steps to a call is done in Voizo's
   Script Builder. IMPORTANT: the answers to "who's calling?", "not interested", "don't call me" and "is this a
   scam?" are shared by all the offers' agents, so changing one changes it for every offer; the window shows a yellow
   warning before you save. A line that is also used by other Voizo campaigns can't be changed here (it says so when
   you ask); an offer's own goodbye line can. Limits: 40 questions per offer per day, and a
   suggestion must be saved within 30 minutes (after that, ask again).
   **Contact form** (shows when the lead has a website or contact page) sends a message through the "Contact us"
   form on THEIR website: it first shows a screenshot of their form (free, about a minute), then you pick the
   mailbox and what you're offering (same ready-made emails and saved templates as Send email), edit the message,
   and press **Send via their form**. AI fills in the form with your mailbox's name and address and clicks send
   once (a few cents, about a minute); you then see the filled form and their page after sending. Phone and
   anything we don't know stay empty; a CAPTCHA or a required field we can't fill means it stops and sends
   nothing. "May have been sent, check their page" means it couldn't confirm: look before trying again so they
   don't get it twice. A sent form shows as "Contact form sent" on the timeline and moves the lead to Contacted.
   The same pause switch and unsubscribe rules as email apply. "Run database update 065 first" = ask the developer.
   AI Lookup replaced "Find contacts (AI)" and "AI profile". Its findings appear in an **AI Lookup**
   box under the Contact card: a short summary, then one line per detail (emails, phones, owner, contact page, what
   they do, other people, website, address, hours, social pages, services, founded, size, reviews), each marked
   **In use** (the lead already uses it), **New** or **Checked**, with **Verify** and **✕ Remove**:
   - Verify on an email or phone makes it the lead's main email / phone. The previous one is NOT deleted: it moves to
     **More emails / More phones** on the Contact card, where **Use this** switches back.
   - Verify on the owner or contact page saves it on the lead. Verify on anything else marks it checked.
   - Remove hides that detail (nothing on the lead changes).
   It fills email / phone / owner / contact page by itself only when the lead has none, adds a note to the CRM
   timeline, and is saved (reopening the page is free). Running it again keeps your earlier Verify / Remove choices.
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
6. **Follow up.** Replies land in [Inbox](/inbox). Drag the lead on the [CRM](/crm) board to meeting booked, won or
   lost (the lead page's Meeting / Close out panels are hidden for now). The old Rebuild site, Improve form and Hand over panels were removed from the
   lead page.

## Batch sources (the first choice in the New batch form: "What are you looking for?")

- **Local businesses** — Google Maps. Pick category + niche, country, city. Niche **Any (all N niches)** searches
  every niche in that category in one batch (e.g. Home Services → locksmith, plumber, electrician…), sharing the lead
  limit between them; the same business found twice is kept once. The data provider sits in a collapsed
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

Opened by **Send email** on the lead's Contact card, or the envelope button on a Leads list row.
- **To** with the address status, and **From**: pick the mailbox.
- **What are you offering?** New website, Website redesign, AI voice agent (answers their calls), AI booking /
  calendar agent, SEO, We buy their inventory (closing business), Exhibition stand (trade-show exhibitor), or Write
  my own. The one that fits the lead is picked for you, marked "(fits this lead)". Picking a service fills in a
  ready-made email with the business name, the owner's first name when known, the city, the demo link (website
  emails, when a demo exists) and your name. Edit anything; it is sent exactly as written.
- **Follow-ups if they don't reply** (back since 24 Nov 2026): a switch in Send email, **off by default**, so Send
  email sends one email unless you turn it on. On: pick 1 (day 4) or 2 (day 4 and day 8). Each is pre-written
  (a saved template's own follow-ups fill in) and editable, and goes from the same mailbox as a reply
  ("Re: <subject>"). They stop by themselves on a reply, a bounce or an unsubscribe. The lead page's follow-up card
  and **Email selected** stay hidden for now.
- The first email goes right away. A never-checked address is checked first (under 1 cent); unsubscribed or bad
  addresses are never emailed. Replies land in the Inbox.

## Emails

- All email goes out through Ongage, from a connected mailbox address ([Email](/email-accounts)). Replies are read
  from that mailbox.
- Send email checks a never-checked address first, for free: it must be written correctly, must not be a typo
  (gmial.com), a throwaway, a placeholder (you@example.com) or a no-reply address, and the company's domain must
  still exist and take email. Passing that shows **Looks OK** and the email can go out. It's not proof the mailbox
  exists, so a few may still bounce. Hunter, ZeroBounce or MillionVerifier add a stronger check (**Ready to send**)
  when one has credits; none is needed to send. Use **Verify emails** on [Leads](/leads) for many at once, or
  **Re-verify email** on one lead after editing its email.
- "This address failed the email check": a typo, a throwaway or placeholder address, or a company domain that no
  longer exists; find another address. "Couldn't be checked right now": the domain didn't answer; try again.
- An AI-call campaign cannot call leads in Malta, the UK, Ireland, Germany, France, Spain, Italy, Portugal, the
  Netherlands, Sweden, Norway, Poland or Greece (GDPR rule); email them instead.
- Follow-ups and the classic sequence stop by themselves on a reply, a bounce or an unsubscribe.
- **Templates** ([Templates](/email-templates)): save your own emails with placeholders like {{business}},
  {{first_name}}, {{city}}, {{demo_link}}. Every save keeps the old version: open History to see or restore one.
  Archive instead of delete. In Send email they appear under "Saved templates"; **Save as template** saves what's
  in the window, **Regenerate** rewrites it with AI (same facts and links), and website emails have an
  **Include the demo website link** switch.
- **Call logs** ([Call logs](/call-logs)): every AI call we placed. Click one to play the recording, read the
  transcript and download both (recording + .txt) — for training the voice agents. Filters: voice agent, result, dates,
  test numbers only. Recordings arrive within ~15 minutes of the call. Also on the CRM panel: "Listen · transcript".
  Our calls are kept here only, never in Voizo's reports.
- **Test voice agent** (lead page / Leads list row): talk to the voice agent from your browser (microphone) with that
  lead's name, business, type and offer — no phone call, any lead, any time. A warning shows if the script uses a detail
  the lead doesn't have (the agent would skip those words). Up to 50 test calls a day.
- **Voice agent:** AI calls use one script, **Lead Gen API (shadow)** — the only one we're allowed to use. Call with AI
  shows it as the voice agent; there's nothing to pick or set up. To hear it before calling a real lead, use Call with
  AI on a lead outside Europe with your own number in "Number it dials".
- **Review sites** (New batch → Review sites): businesses with a low rating on Trustpilot or TripAdvisor (default
  1–3.5 stars, at least 5 reviews). Trustpilot searches a country by category (e.g. car_dealer, city optional);
  TripAdvisor searches a city for restaurants, hotels or attractions. They're pitched **reputation management**
  (OptiRate) with Send email, which starts on Ethan or Lily. They're never built a website, can't be AI-called yet,
  and the lead shows "Found on TripAdvisor · 2.4★ · 38 reviews · View profile". Found again later = rating refreshed.
- Bounces, unsubscribes and "marked as spam" reports come back from Ongage every 10 minutes (once its webhook is set
  up): a hard bounce marks the address bad so it's never emailed again; an unsubscribe or spam report blocks the lead.
  They show in the lead's Outreach log and CRM history.
- Replies are read from our mailboxes (grace@, ethan@, lily@) every 5 minutes, or straight away with **Sync replies**
  in the Inbox. A real reply shows in the [Inbox](/inbox) as needing a reply and moves the lead to **Replied** (Leads
  list and CRM). The reply is matched to the lead by the sender's address, or by the email it answers.
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
- On any lead, click **AI Lookup** (Contact card, or the sparkle button in the Leads list): OpenAI web
  search plus their own website, about 2–5 cents, up to a minute. It fills in email, phone, owner and contact page
  when the lead has none and never overwrites; everything it found shows under the Contact card to verify or
  remove. Results are from public pages; the sources are listed under "where this came from". On a local
  business, an email that reaches its head office, franchisor or an agency is listed but never made the main email
  by itself: press Verify on it if you want to use it. Pressing AI Lookup again within 2 minutes is refused, so
  you don't pay twice. It also runs on closing businesses (WARN / SEC batches) while scraping.
- Or type an email, phone, website or contact page in by hand (pencil icons on the Contact card). Emails are
  checked when you send; a new website clears the old website check, so pick the pitch in Website verdict.
- A yellow note under the email means it isn't on their website's domain (for example a web designer's or a
  hosting company's address): check it is really theirs before sending.
- No email is not a dead end: **Call with AI**, or DM them from [Social](/social).

## Which emails work (Templates page → Results) and wording tests

- Outreach → Templates → **Results** shows, for each email used (a ready-made one like "SEO", or a saved template):
  how many were sent, how many got a reply, the reply rate, how many were edited before sending, unsubscribes and
  bounces. Pick last 30 days, 90 days or all time. A reply counts for the last email sent to that lead before it.
  Emails sent before 24 Nov 2026 show as "Before tracking". With under about 50 sends the rate swings a lot.
- **Wording test**: compare two versions of one offer's email. Write version B as a saved template first (New
  template, set its offer), then Results → **Start a wording test**, pick the offer, version A (what you use now) and
  version B. While it runs, Send email for that offer fills A or B taking turns and says which; you can still edit.
  When each version has 30 sends, compare and press **Keep A** or **Keep B**. If you keep a saved template, Send
  email starts that offer with it from then on. One test per offer at a time. If the page says it needs database
  update 066, tell the developer.

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
- A call someone answered moves the lead to **Contacted** (Leads list stage + CRM column), and "interested" moves it
  to **Replied**, the same way an email does. No answer / wrong number leaves the stage as it was.
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
