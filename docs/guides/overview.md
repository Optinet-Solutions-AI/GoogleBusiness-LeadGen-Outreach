# What this app does (plain overview)

It finds local businesses, sorts them by what they need, and helps you **call** them with an AI voice agent to offer a service. Everything is organized so you're never guessing what to do next.

## The big flow
1. **Scrape** businesses from Google Maps (a "batch").
2. The app **sorts each lead** into one of three groups (we call them *segments*):
   - **No website** → pitch building one.
   - **Old / weak website** → pitch improving it.
   - **Good website** → a "what do you need?" chat (different script).
3. You build a **campaign** = a list of leads to call (pick by country, category, how many, and a calling schedule).
4. You **work the call queue** for that campaign — the AI agent's script is ready per segment; you (or, later, the AI dialer) make the calls and log how each went.
5. Interested people land in the **Inbox** for follow-up.

## The left menu, page by page
| Page | What it's for |
|------|---------------|
| **Today** | Your at-a-glance home: what needs attention + key call numbers. |
| **Batches** | The raw scrapes — where leads come from. |
| **Leads** | Every lead, searchable/filterable. |
| **Campaigns** | Your calling jobs. Make one, then open it to work its call list. Each shows contacted / interested / success rate. |
| **Inbox** | People to follow up with (interested calls + replies). |
| **Analytics** | The "are we winning?" view — funnel, conversion, cost. Read it top-to-bottom. |
| **Agent** | Improve the AI caller — edit its prompt, pick a voice, test it in the browser. See [agent-tuning.md](agent-tuning.md). |
| **Status** | System/deployment status. |

## What's live vs. coming
- **Live now:** scraping → segments → campaigns → manual calling + logging → analytics/inbox; and the in-browser **Agent** tester.
- **Coming (needs phone numbers + keys):** the AI making the *actual phone calls* automatically, the SMS "text a link" step, and call-hours/spend enforcement. Until then it's testing + manual calling.

New to the words here? See the [glossary](glossary.md).
