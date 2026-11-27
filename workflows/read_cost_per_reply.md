# Read cost per reply (where to scale)

Since 27 Nov 2026 · Analytics page → **Cost per reply** · spec `docs/superpowers/specs/2026-11-27-lead-score-and-cost-per-reply-design.md`
(Part 2) · code `web/lib/analytics/cost-per-reply{,-load}.ts`

## What it answers

For each **niche**, **city** or **offer** (switch at the top right), over the last **30 days**, **90 days** or
**all** time: what we spent and what one reply cost. Scale the rows with a low cost per reply; drop or rethink the
expensive ones.

## Columns

| Column | Meaning |
|---|---|
| Leads found | Every lead the batches in this range saved (qualified or not) |
| Contacted | Leads that got at least one email that really went out, a contact form, or an AI call |
| Emails sent | Emails that really went out (first emails + follow-ups) |
| Replies | Leads that sent a human email reply (auto-replies, bounces, unsubscribes don't count), once per lead |
| Reply rate | Replies ÷ Contacted |
| Interested calls | Leads an AI call marked interested |
| Spend (estimated) | Each batch's cost estimate shared evenly over all its leads, plus the real cost of their contact forms |
| Cost per reply | Spend ÷ Replies ("—" with no replies yet) |

## Rules to keep in mind

- **The range goes by when the batch was made.** A batch's whole spend and everything its leads got (contacts,
  replies) belong to it, so leads never reached still count as cost.
- **Spend is an estimate.** There is no recorded real bill per batch. AI call minutes (Voizo), email sending (Ongage)
  and one-off re-checks you press later (AI Lookup again, Check website again, Score again) aren't included.
- **Test mode is left out.** While Test mode is on, sends only reach test contacts. Test mode remembers when it was
  switched on and off (`app_settings.test_mode.history`), and everything that happened during those times is ignored.
  Until the app goes live, the table shows leads found and spend but almost no contacts or replies.
- **Niche:** a batch's niche; "Any …" batches use each lead's own Google category. **Offer:** the offer the lead's
  segment pitches (Build a website, Redesign, AI receptionist, …). **City:** the batch's city.

## Free

Opening the page makes no paid calls.
