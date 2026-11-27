# AI reply handling (drafts first) — design

Date: 27 Nov 2026 · Source: competitor research Part IV idea 1 (Artisan, 11x, AiSDR; AiSDR starts with reply
automation off until there is real reply data) · Project 3 of 3 · "Brain project 2" in CLAUDE.md.

## Why

Today every human reply lands in the Inbox as "needs reply" and a person reads and answers each one by hand. Nothing
tells an interested reply from a "no thanks", a question or "talk to my manager", so the operator can't work the
valuable ones first, and the Brain counts every reply as a win (even "not interested").

The operator wants the AI to **read each reply, sort it and write the answer as a draft**; a person sends it with one
click (operator decision, 27 Nov 2026: "draft first"). Sending by itself may come later, once there is real reply data.

Success: the operator opens the Inbox and sees, per reply, what kind it is ("Interested", "Question", …), a one-line
summary, and a ready answer they can send, edit or redraft. The interested ones are on top.

## Goals

1. Every **human** reply (as the inbox reader already decides) is sorted by the AI into one category and gets a
   one-line summary and a draft answer, **right when it arrives** (operator picked approach A, 27 Nov 2026).
2. The Inbox shows the category, puts **Interested** and **Question** first, and pre-fills the reply box with the
   draft. Sending is the existing Inbox reply (one click, editable). A **Redraft** button asks for a new draft.
3. A reply asking us to stop ("remove me", "don't email me") marks the lead **unsubscribed** (honour opt-outs at once).
4. The Brain: **Not interested** and **Stop** replies count as *stopped*, not a win; every other reply stays a win.

## Non-goals

- **The AI never sends anything.** No automatic sending, no send button outside the existing Inbox reply.
- No meeting booking / calendar links (a later project).
- No change to how bounces, auto-replies and unsubscribe headers are detected (`auto-reply-detector.ts` stays).
- No reply handling for contact-form answers or calls (they arrive differently).

## Anti-goals

- A draft that promises what we can't keep: prices, discounts, guarantees, dates, features we don't offer. The AI is
  told what the offer is (from the ready-made email for that offer) and may only restate it; anything else = "I'll
  check and get back to you".
- A draft that pretends a person wrote something they didn't, or invents names / facts about the business.
- Paying twice for one reply (a re-run of the reader must not draft again).
- Losing an opt-out: a "please remove me" must never sit unread as a normal reply.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | Sort + draft right when the reader stores a human reply | Sorted before anyone looks; the Brain gets the category; ~1¢ per reply even for ones you'd ignore |
| B | Only when the operator presses "Draft with AI" | Pay only for opened replies, but nothing sorted ahead and the Brain can't use it |
| C | A separate sweep in the automation tick | Same as A, up to 15 minutes later, a second place reading replies |

## Categories (my proposal)

| Category | Meaning | Draft | Extra |
|---|---|---|---|
| `interested` | Wants to talk / see more / asks how to start | Thank them, propose a short call and ask for a good time | Inbox top |
| `question` | Asks something before deciding (price, how it works) | Answer only from the offer facts; otherwise say we'll check | Inbox top |
| `not_now` | Maybe later / busy / come back in N months | Polite, offer to follow up later | CRM next follow-up in 30 days when none is set |
| `wrong_person` | Not their area / forwards to someone else | Thank them; ask who the right person is (or thank for the intro) | — |
| `not_interested` | Clear no | Short, polite close | Brain: stopped |
| `stop` | Asks to be removed / not contacted | **No draft** | Lead → `lifecycle_stage = 'unsubscribed'`; Brain: stopped |
| `other` | Anything else | A neutral answer, or none | — |

## How it works

- **Where:** `lib/pipeline/inbox-sync.ts` already stores each inbound message and decides `human`. After storing a
  human reply it adds the message to a short "to draft" list; after the mailbox loop, a drafting pass handles that
  list (one OpenAI call each). Runs on Cloud Run (`MODE=inbox`, the inbox-sync tick) with a time budget
  (my call: 8 minutes) and a cap per run (`REPLY_AI_MAX_PER_RUN`, default 30). The manual "Sync replies" button runs
  on Vercel (60 s limit): it **skips drafting** and the next tick (minutes later) drafts (builder check: simplest,
  never times out). A reply that wasn't drafted (cap, budget, OpenAI down) is picked up by the next run, up to
  **3 tries** (`ai_attempts`); the Inbox shows "Drafting…" / "No draft yet" and the **Draft with AI / Redraft** button
  works on it. No automatic backfill of replies from before this ships: the button covers them.
- **The AI reads:** the reply text (quoted history trimmed), our last email to them before the reply (subject + body,
  from `email_messages` outbound), the business name, category and city, the offer we pitched and the sender's first
  name for the sign-off. **The offer** = the one recorded on our last `email_sent` event (`meta.email_used.key`
  `service:<offer>`), else the lead's default offer for its segment (contact-form / call-only leads, older sends).
  **The only facts it may state** = that offer's ready-made email text (`lib/email/service-templates.ts`) plus what
  our last email actually said. Strict JSON schema: `{ category, summary, body, referral? }` (no subject: the Inbox
  reply keeps "Re: <their subject>" so it stays in the same thread) (referral = a name / email the reply points to, for
  `wrong_person`; saved into a CRM note, never emailed automatically).
- **Model:** `OPENAI_REPLY_MODEL` (default `gpt-5.4-mini`, priced with `OPENAI_CONTACT_USD_PER_MTOK_*`, ~1¢ a reply),
  through `lib/services/openai-brain.ts` `brainJson` with a model override, like the lead score.
- **Once per reply:** the draft is saved on the inbound message; a message that already has a category is never
  drafted again by the reader. **Redraft** (Inbox) makes one new call, refused within 1 minute of the last one.
- **Sign-off / language:** the draft answers in the reply's language and signs with the mailbox's from-name
  ("Best regards,\n{sender}", the house style since 26 Nov 2026).

## Storage (migration 078)

On `email_messages` (the inbound row): `ai_category text`, `ai_summary text`, `ai_draft_body text`,
`ai_referral jsonb`, `ai_at timestamptz`, `ai_usd numeric`, `ai_error text`, `ai_attempts int`.
On `leads`: `reply_category text` (the latest reply's category, for Inbox sorting and the Brain). Code tolerates all
of them missing (the reader then stores replies exactly as today).

## What each category does to the lead (builder check, my calls)

- Every human reply still moves the lead to **Replied** as today (they did reply; the CRM stays true).
- `leads.reply_category` = the **latest** reply's category; a second reply re-sorts the lead.
- `interested`, `question`, `wrong_person`, `other`, `not_now`, `not_interested` keep `inbox_status = needs_reply`
  (a person still sends or skips the draft). `not_now` also sets `next_follow_up_at` = +30 days when empty.
- `stop` uses the **existing opt-out path** exactly like an unsubscribe the reader detects today:
  `lifecycle_stage = 'unsubscribed'`, an `email_unsubscribe` event (`meta.source = 'ai_reply'`), the sequence stops,
  and `inbox_status = 'closed'` (no answer needed).
- **The Brain** (`lib/brain/due.ts` `stopReason`) reads `reply_category` **before** the "they replied" win:
  `not_interested` → stopped ("Said not interested in their reply"), `stop` → already stopped by `unsubscribed`.
  While the latest reply has **no category yet and is less than 1 hour old**, the Brain records nothing for that lead
  (it waits for the drafting pass, so a "no" is never stored as a permanent win); after an hour without a category it
  is a win, as today.

## Where the operator sees it

- **Inbox list:** a category chip on each lead ("Interested", "Question", "Not now", "Wrong person",
  "Not interested", "Asked to stop"); Interested and Question sorted first among the ones that need a reply; a filter
  by category.
- **Inbox thread:** above the reply box, "AI read this as: Interested — 'Wants to see prices next week'"; the reply
  box is pre-filled with the draft body and can be edited; **Send** is the existing reply; **Redraft**
  asks for a new one. A `stop` reply shows "They asked not to be contacted: marked unsubscribed. No answer needed."
- **The Brain:** a running job's lead with a `not_interested` / `stop` reply becomes *stopped* ("Said not interested
  in their reply" / "Asked to stop in their reply"); other replies stay a win.

## Constraints

- Golden rules (CLAUDE.md): pure rules file with tests (categories, what each does, the prompt input, parsing),
  OpenAI through `lib/services/`, thin routes, dumb components, required headers, zod at routes.
- Test mode unchanged: replies only come from test contacts while it's on; sending still goes through the existing,
  gated Inbox reply.
- Paid calls only on real human replies, capped per run, logged with cost.
- Workflow first: `workflows/handle_replies_with_ai.md`; CLAUDE.md, `lib/assistant/knowledge.ts`,
  `run_brain_job.md`.

## Left to the builder

Prompt wording; how quoted history is trimmed; chip colours; exact Inbox layout; how the drafting pass is batched
inside the time budget.
