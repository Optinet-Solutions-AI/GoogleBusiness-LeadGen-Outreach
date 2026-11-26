# Client acquisition platforms — competitor research

Research date: 26 Nov 2026 · Scope: 10 AI-powered client acquisition platforms · Purpose: product development and
competitor research for this app (RateUp lead-gen: Google Maps and signal discovery, email, contact forms, AI calls).

Status: desk research complete for all 10 (Parts I–III, provided by the operator). Part IV is a first-pass comparison
with this app, written by Claude from the codebase; the detailed gap analysis is the next phase. More research will be
added (see "Add more here" at the end).

**Limits of the research:** public websites, technical docs, help centres and vendor-published figures only.
Production reliability, proprietary algorithms, internal costs and real client-conversion rates were not tested or
verified. A vendor figure below is a claim, not a measured result.

---

## Part I — The ten platforms

### 1. Explee — autonomous customer acquisition

- **Scale (claimed):** 105M+ companies, 80M+ decision-makers, 210M+ map locations. **$0.04 per email sent.**
- **Process:** user enters their website → AI works out products, services, value proposition → proposes customer
  segments → finds matching companies → finds decision-makers → verifies contacts → writes personalised emails → sends
  through managed infrastructure → handles follow-ups and interested replies → routes prospects to appointments →
  optimises campaigns on performance.
- **Business intelligence:** starts from the seller's website instead of search filters, so the user needs little
  marketing knowledge.
- **Data:** semantic search by business meaning, custom AI enrichment criteria, targeting by industry / role / size /
  location, CSV import, verification before sending. Datasets also sold separately.
- **Email infrastructure (a strong product decision):** managed pre-warmed mailboxes, SPF / DKIM / DMARC set up for the
  customer, mailbox health monitoring, automatic suspension of bad mailboxes, customer-controlled budgets. The
  customer's main domain is never used.
- **Campaign optimisation:** each customer segment is a campaign judged by **cost per lead**, e.g. (Explee's own
  illustration) event designers $1.69 and wedding florists $1.87 (scaling), wedding planners $2.02 (working), property
  management $5.80 and houses of worship $6.33 (paused). Optimises for interested prospects per dollar, not open rates.
- **Pricing:** discovery free; pay per email sent; $30 introductory credit. Their calculator: $100 → 2,500 emails →
  about 11.1 "hot leads" at their published $9 median (a hot lead is not a meeting or a customer).
- **API:** asynchronous campaign imports, automatic discovery campaigns, fetch interested prospects for a CRM.
- **Key innovation:** sells acquisition outcomes through one simple usage-based product instead of a toolbox.

### 2. Maplo — local business acquisition and opportunity detection

- **Claimed:** 3,000+ business categories, 200+ countries, **€99/month**.
- **Process:** pick geography + categories → filter on website / business quality → see the estimated prospect volume
  before starting → background Google Maps discovery → analyse each website → identify specific business problems →
  personalised outreach built on the audit → contact by chosen channel → inbox + CRM → Kanban pipeline.
- **Discovery filters:** location, radius, several categories, rating, review count, website condition, required
  contact channels; live estimates and real-time map results.
- **Problem detection → offer:** missing website → website build; outdated → redesign; platform detection → migration;
  mobile issues → mobile work; SSL issues → security; slow site → performance.
- **Outreach:** AI combines the detected problem with the user's offer for email, WhatsApp, LinkedIn. (How autonomous
  each channel really is was not verified.)
- **Pricing:** one subscription covering discovery, audit and outreach.
- **Key innovation:** find businesses with an identifiable problem and use the evidence of it as the pitch.

### 3. Convoro — AI email and phone acquisition

- **Pro $149/month:** 50 emails a day per account, 5 AI calls a day per call campaign, calls up to 3 minutes.
- **Process:** business profile + offer → local discovery → email campaign (AI introduction) and/or AI voice campaign
  (interactive sales conversation) → scheduling (daily volume, hours, timezone, 1–30 days or continuous) → outcomes:
  replies, appointments, callbacks, opt-outs.
- **Voice agent:** introduction, checks interest, schedules a callback, records a booking or a do-not-call request.
  Shared US phone numbers; recordings and transcripts kept.
- **Limits:** email follow-ups not automated; billing = subscription + usage.
- **Compliance gap (stated by Convoro):** it does **not** screen numbers against national do-not-call registries.
- **Key innovation:** local discovery + conversational AI phone calls (at low volumes).

### 4. Artra AI — customisable AI sales agents and workflows

- **Onboarding:** connect Gmail / Outlook → AI persona (product, audience, tone) → import contacts or connect CRM →
  mailbox warm-up → build sequences → approve the first messages → activate agents.
- **Modules:** overview, unified message centre, contacts (dedup), sequences, agents (workflow builder), **Max** (chat
  assistant), marketplace, calls (voice + SMS via Twilio), deliverability, API.
- **Max:** natural-language instructions ("find 100 sales managers at fintech companies", "who needs a follow-up
  today?", "which campaign gets the most replies?", "draft a reply", "create a recurring discovery workflow"). It
  **proposes a plan and asks for approval before anything that spends credits or sends messages.**
- **Workflow shape (reconstructed):** trigger (schedule / event) → discovery → AI research → qualify against targeting
  → qualified: enrol in a sequence / unqualified: exclude.
- **Marketplace:** users publish and clone automation workflows; creators earn credits when cloned (like n8n
  templates, for sales).
- **Pricing:** Free $0 (100 emails/day, 100 credits, 1 mailbox) · Pro $70 (1,000/day, 2,500 credits) · Pro+ $120
  (2,500/day, 1,000 SMS, 300 call minutes, 5,000 credits) · Scale $500 (10,000/day, 5,000 SMS, 1,500 minutes, 25,000
  credits). Unlimited mailboxes from Pro. AI research / enrichment / personalisation consume credits.
- **Key innovation:** customers build their own acquisition agents instead of one fixed sales process.

### 5. Sellbird — MCP-native sales infrastructure

- **Architecture:** the reasoning lives in the user's own AI (Claude, ChatGPT, Codex / Cursor) connected through a
  remote **MCP server** (OAuth + tool permissions); Sellbird is the execution layer: lead search, verification,
  campaigns, mailboxes, CRM, calendar, persistent data, scheduling, sending, reply collection, meetings.
- **Permissions:** find companies / decision-makers, verify emails, prepare campaigns, draft replies = allowed · send
  campaign messages = approval or owner-enabled autopilot · send generated replies = approval · activate autopilot =
  workspace owner only · approve purchases = never the agent.
- **Notes:** it doesn't supply the model (bring your own); MCP alone doesn't keep an agent running between sessions
  (a separate runtime is needed). Open-source self-hosted version advertised alongside hosted early access; production
  readiness, pricing and channel coverage unverified.
- **Key innovation:** a model-independent sales execution platform that outside AI agents can drive.

### 6. Artisan — Ava 2.0, an "AI sales employee" (launched May 2026)

- **Lifecycle:** business knowledge + targeting → watch buying signals → find and rank decision-makers → research each
  prospect → individual outreach → multistep campaigns → **answer questions and objections** → queue interested
  prospects for reps → book meetings on calendars.
- **Buying-intent signals:** new funding, leadership changes, hiring, technology changes, website visits, product
  activity.
- **Campaign types:** new prospects, re-engaging warm prospects, upselling existing customers, signal-triggered outreach.
- **Also:** ML lead prioritisation; configurable human approval; the dialer queues prospects for reps (not autonomous
  cold calling). 250M+ verified B2B contacts. Pricing by team / motion / volume (custom).
- **Key innovation:** the AI keeps the conversation going after the first contact.

### 7. 11x — autonomous inbound and outbound "digital workers"

- **Alice (outbound):** discovery, signal research, personalised messages, multichannel sequences, reply
  classification, booking. Signals: hiring, funding, leadership, technology, website visits, review sites + live web
  research. 105+ languages.
- **Julian (inbound):** answers inbound leads, conversational voice, real-time qualification, SMS and WhatsApp,
  booking, hand-off to reps.
- **Onboarding:** connect CRM, authenticate sending domains, build a knowledge base, define the ICP, set channels,
  frequency and exit conditions. Agent quality depends heavily on the knowledge base.
- **Example sequence (illustrative):** find → personalised email → LinkedIn where appropriate → consented call or other
  permitted channel → analyse responses → stop on an exit condition → book or hand off.
- **Deliverability:** automatic pacing, domain authentication checks, mailbox health monitoring, campaign suspension.
- **Analytics:** judged on pipeline contribution, not reply rates. Enterprise pricing (not confirmed).
- **Key innovation:** separate outbound and inbound agents sharing one business knowledge layer.

### 8. LeadSwift — real-time local business acquisition (a direct competitor to our Google Maps discovery)

- **Process:** category + location search → collect from maps and directories → enrich (incl. decision-makers) →
  analyse marketing / website / SEO weaknesses → filter by characteristics → AI personalisation → email sequences from
  connected senders → test variations, monitor results.
- **Data collected:** identity, contacts (email, phone, website), owners / managers, ratings and reviews, website
  technology, website keywords and HTML matches, SEO visibility, social profiles.
- **Competitor-customer discovery:** search website content / HTML for keywords or technologies — e.g. businesses using
  a competing booking system, a given website platform, or a competitor's embedded widget.
- **Dual contact discovery:** named decision-makers AND general business inboxes (small-business owners often have no
  LinkedIn or public personal email).
- **Outreach:** sender rotation, sequences, A/B tests, AI personalisation.
- **Pricing:** by daily searches, not per record. Professional: 5 searches a day, $49.99/month ($39.99 annual).
- **Key innovation:** real-time local discovery + technical website intelligence + outreach without per-contact fees.

### 9. AiSDR — signal-driven acquisition and smart follow-ups (agent "Ami")

- **Process:** positioning + audience → define buying signals → continuously find matching prospects → enrich and
  verify → research needs → AI campaign strategy → email + LinkedIn → manage replies and follow-ups → book meetings.
- **Custom signals:** users define their own, e.g. for AI automation services: hiring support reps, recruiting SDRs,
  talking about operational inefficiency, announcing expansion, discussing competing software.
- **Waterfall enrichment** across ~20 data providers when the first one has no contact.
- **Execution controls:** email accounts + LinkedIn, audience-timezone scheduling, sender balancing, sequence builder,
  Smart Replies, mailbox monitoring, unified inbox, HubSpot. **AI reply automation starts OFF**, enabled after real
  response data has been gathered.
- **Pricing (per prospect contacted):** pay-as-you-go $1.50 per person · Solo $250/month (200 prospects, 3 mailboxes) ·
  Team $450 (400) and $600 (600), 6 mailboxes · Custom from 1,200/month.
- **Key innovation:** charges for researched, contacted prospects and focuses on timely signals over volume.

### 10. Salesforge — Agent Frank and an integrated infrastructure ecosystem

- **The "Forge" family:** Agent Frank (intelligence + autonomous execution), Leadsforge (discovery), Mailforge (email
  infrastructure), Infraforge (private infrastructure), Megaforge (multi-provider), Warmforge (warm-up), Salesforge
  (campaigns), Primebox (central replies).
- **Onboarding:** sales demo → workspace → knowledge base (documents + website) → mailbox capacity → warm-up → ICP or
  import → agent settings (autopilot / copilot, language, personalisation sources, conversion goal: a URL, a booking
  link, or asking for their calendar link) → continuous prospecting and outreach.
- **Active-contact capacity:** e.g. 1,000 simultaneous active prospects; a prospect who replies, unsubscribes or
  finishes the sequence frees its slot for the next. Advertised 2,000–2,500 prospects and 6,000–7,500 emails a month.
- **Pricing:** Agent Frank from $499/month (annual) for 1,000 active contacts; email infrastructure extra.
- **Key innovation:** vertical integration of discovery, AI reasoning, execution and email infrastructure.

---

## Part II — Consolidated competitor intelligence

### Capability matrix (publicly documented; ● documented · ◐ partial / conditional / assisted · — not established)

| Capability | Explee | Maplo | Convoro | Artra | Sellbird | Artisan | 11x | LeadSwift | AiSDR | Salesforge |
|---|---|---|---|---|---|---|---|---|---|---|
| Website-based business understanding | ● | ◐ | ◐ | ◐ | ● | ◐ | ◐ | — | ◐ | ● |
| Local business discovery | ● | ● | ● | ◐ | ◐ | — | — | ● | ◐ | ◐ |
| Website problem detection | — | ● | — | ◐ | ◐ | — | — | ● | ◐ | ◐ |
| Decision-maker discovery | ● | ◐ | — | ● | ● | ● | ● | ● | ● | ● |
| Contact enrichment | ● | ● | ◐ | ● | ● | ● | ● | ● | ● | ● |
| Email verification | ● | — | — | ◐ | ● | ● | ◐ | ◐ | ● | ● |
| Buying-signal monitoring | ◐ | — | — | ◐ | ◐ | ● | ● | ◐ | ● | ◐ |
| AI email personalisation | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Email follow-ups | ● | ◐ | — | ● | ● | ● | ● | ● | ● | ● |
| LinkedIn outreach | — | ◐ | — | ● | — | ◐ | ● | — | ● | ● |
| SMS outreach | — | — | — | ● | ◐ | — | ● | — | — | — |
| WhatsApp outreach | — | ◐ | — | — | — | — | ● | — | — | — |
| Autonomous voice outreach | — | — | ● | — | ◐ | — | ◐ | — | — | — |
| Human-assisted dialer | — | — | — | ● | ◐ | ● | ◐ | — | ● | — |
| AI reply handling | ● | — | — | ◐ | ◐ | ● | ● | — | ● | ● |
| Meeting booking | ● | — | ● | ● | ● | ● | ● | — | ● | ● |
| Managed mailboxes | ● | — | ● | ◐ | ● | ◐ | ◐ | — | ● | ● |
| MCP integration | — | — | — | — | ● | — | — | — | — | — |
| Custom agent workflows | — | — | — | ● | ◐ | ◐ | ◐ | — | ◐ | ◐ |
| Campaign optimisation | ● | ◐ | — | ◐ | — | ● | ● | ◐ | ◐ | ◐ |

### Five acquisition strategies

| Strategy | Platforms | Idea |
|---|---|---|
| Website-first | Explee | Understand the seller automatically, find markets, run campaigns with minimal setup |
| Problem-based | Maplo, LeadSwift | Find businesses with a specific deficiency and offer the fix |
| Signal-based | Artisan, 11x, AiSDR | Find businesses going through an event that makes them likelier to buy |
| Agent-based | Artra, Sellbird | Give AI agents flexible tools and let them choose the strategy |
| Infrastructure-based | Salesforge, Convoro | Integrate communication infrastructure with discovery and execution |

### Billing models

| Platform | Primary billing |
|---|---|
| Explee | Per email sent |
| Maplo | Integrated monthly subscription |
| Convoro | Subscription + communication usage |
| Artra | Subscription + AI credits |
| Sellbird | Hosted infrastructure; pricing unverified |
| Artisan | Custom enterprise |
| 11x | Enterprise subscription |
| LeadSwift | Daily search allowance |
| AiSDR | Per prospect contacted |
| Salesforge | Simultaneous active contacts |

Each billing mechanism encourages different customer behaviour and needs different infrastructure.

---

## Part III — Technical research for future development

### Reference architecture (proposed from the capabilities, not reverse-engineered)

```
Customer onboarding            website URL · business documents · product offering
        ↓
Business intelligence engine   knowledge base · ICP generation · value proposition
        ↓
Sources                        Maps (local) · B2B data · live web · buying signals · CRM · imports
        ↓
Lead intelligence pipeline     enrichment → deduplication → verification → qualification → scoring
        ↓
AI acquisition orchestrator    strategy · personalisation · channel selection · next action
        ↓
Compliance + approval gateway  consent · suppression lists · limits · human approval
        ↓
Channels                       email · SMS · voice · social
        ↓
Unified conversation engine    reply analysis · objections · follow-ups · qualification
        ↓
Conversion engine              meetings · CRM opportunities · paying customers
        ↓
Performance feedback engine    acquisition costs · conversion rates · segment optimisation  (feeds back up)
```

### Lead intelligence data structure

| Entity | Suggested fields |
|---|---|
| Organisation | name, domain, description, industry, size, location |
| Business location | address, opening hours, Maps ID, coordinates |
| Contact | name, position, email, phone, professional profile |
| Verification | status, provider, confidence, last verified date |
| Website audit | technology, performance, mobile readiness, SEO issues |
| Buying signal | type, evidence, date, source, confidence |
| Qualification | ICP match, exclusions, opportunity score |
| Campaign | segment, goal, budget, permitted channels |
| Conversation | messages, replies, intent, objections, next action |
| Appointment | calendar, status, time, attendance |
| Conversion | deal value, status, acquisition source |
| Compliance | consent, lawful basis where applicable, suppression status |
| Cost ledger | research, verification, email, voice, SMS and AI costs |

Persistent, evidence-backed prospect records let agents decide from facts instead of an isolated prompt.

### Example lead scoring (hypothetical: AI receptionist for a plumbing company → 89/100)

| Factor | Weight | Factor score | Points |
|---|---|---|---|
| Industry matches target | 25 | 100 | 25 |
| Evidence of a missed-call problem | 20 | 80 | 16 |
| No online booking | 20 | 100 | 20 |
| Business growth signal | 15 | 60 | 9 |
| Decision-maker identified | 10 | 100 | 10 |
| Verified contact | 10 | 90 | 9 |
| **Total** | **100** | | **89** |

Scores must rest on verifiable evidence: a site without online booking does not by itself prove a missed-call problem.

### AI agent responsibilities

| Agent | Responsibility |
|---|---|
| Business Analyst | Understand the customer's product and target market |
| Market Research | Identify promising segments |
| Discovery | Find suitable companies |
| Enrichment | Find decision-makers and contacts |
| Website Auditor | Identify relevant business and technical problems |
| Signal | Monitor purchase-intent events |
| Qualification | Validate prospect suitability |
| Campaign Strategist | Choose the acquisition strategy |
| Copywriting | Evidence-based personalised messages |
| Communication | Execute approved campaigns |
| Conversation | Understand replies, recommend next actions |
| Booking | Coordinate meeting times |
| Optimisation | Analyse performance, improve campaigns |
| Compliance engine | Enforce consent, permissions, communication restrictions |

Not every component needs an LLM: verification, scheduling, credits, access control, suppression lists and
transaction logging should be deterministic software.

### Acquisition metrics — measure the whole funnel, not contacts collected

Illustrative funnel (not measured competitor performance): **10,000 prospects, $500 total cost** → 70% verified and
contacted → 5% reply → 30% of replies positive → 50% book a meeting → 80% attend → 25% close.

| Result | Value |
|---|---|
| Positive replies | 105 → **$4.76** each |
| Booked meetings | 52.5 → **$9.52** each |
| Paying clients | **10.5** |
| Customer acquisition cost | **$47.62** |

### Advanced capabilities to investigate

| Capability | Reference |
|---|---|
| Business understanding from a URL; AI-generated segments; automatic budget allocation | Explee |
| Managed email infrastructure | Explee, Salesforge |
| Website opportunity detection; real-time Maps discovery | Maplo, LeadSwift |
| Competitor technology detection | LeadSwift |
| AI outbound phone conversations | Convoro |
| Integrated voice + text | 11x |
| Custom agent builder; agent marketplace | Artra |
| External agents through MCP; self-hosted infrastructure | Sellbird |
| Continuous buying-signal monitoring | Artisan, AiSDR, 11x |
| AI objection handling | Artisan, 11x |
| Inbound lead qualification | 11x |
| Waterfall contact enrichment | AiSDR |
| Dynamic active-contact allocation; modular communication infrastructure | Salesforge |

### Research conclusion

Advanced competitors are moving beyond **Search → Scrape → Export → Email** to
**Understand → Discover → Research → Qualify → Engage → Converse → Convert → Optimise**. With this app's existing Google
Maps discovery, email, SMS and AI voice, this research is the baseline for deciding which capabilities to add for a
more autonomous acquisition product.

| Deliverable | Status |
|---|---|
| Research all ten competitors; acquisition processes; AI and automation; technical findings | Completed |
| Pricing models | Completed, with noted gaps |
| Independently test production functionality | Not performed |
| Verify real paying-client conversion rates | Not performed |
| Detailed gap analysis for this app | Next phase (Part IV is a first pass) |

---

## Part IV — First pass: where this app stands (Claude, from the codebase, 26 Nov 2026)

A starting point for the detailed gap analysis, not that analysis. ● have it · ◐ partly · — don't have it.

### Against the matrix

| Capability | Us | What we have today |
|---|---|---|
| Local business discovery | ● | Apify / Google Places / Outscraper Google Maps search, "Any" niche, Daily batches |
| Website problem detection | ● | AI website check: screenshot + measurements → No / Old / Good website, score, reasons, platform + booking detection, what to pitch and why |
| Buying-signal sources | ◐ | Unusual for a local tool: WARN closures, SEC bankruptcy / closure filings, conference exhibitors, low review ratings (Trustpilot / TripAdvisor). One-off searches, not continuous monitoring |
| Contact enrichment | ● | AI Lookup (OpenAI web search + own-site crawl), head-office vs own inbox labelling, other emails / phones kept |
| Decision-maker discovery | ◐ | Owner name when found; no people database |
| Email verification | ● | Free checks + Hunter → ZeroBounce → MillionVerifier ladder (a small waterfall) |
| AI email personalisation | ◐ | Tested ready-made emails per offer + saved templates + Gemini rewrite; the Brain deliberately sends the tested wording |
| Follow-ups | ● | Up to 3, each with its own subject; stop on reply / bounce / unsubscribe |
| Copy testing / results | ◐ | Wording tests (A vs B) and reply rate per email; no cost per lead per segment |
| Website contact forms | ● | AI fills and sends their own-site contact form once, with before/after screenshots. None of the ten list this |
| Autonomous voice outreach | ● | Voizo AI calls per offer, talking points from the email, in-app training, recordings + transcripts |
| SMS | ◐ | Built (Mobivate), dormant |
| LinkedIn / WhatsApp | — | |
| Agent / natural-language control | ● | The Brain: a job in plain words → questions → AI judges each lead inside code-set limits → one plan to approve → autopilot (close to Artra's Max and Sellbird's permission model) |
| Compliance + approval gateway | ● | Approval before sending, suppression, GDPR country block, kill switch, Test mode, budgets. **No national do-not-call registry check** (the same gap Convoro admits) |
| AI reply handling | — | Planned: Brain project 2 |
| Meeting booking | — | A reply is the win today; a person takes it from the Inbox |
| Managed mailboxes / deliverability | ◐ | Warm-up caps, bounce / unsubscribe webhook, kill switch; SPF set, DMARC "none", DKIM unverified; QA's test landed in Spam |
| CRM | ● | CRM board with timeline, follow-ups, tags |
| Lead scoring | ◐ | Website score only; no opportunity score |
| Cost ledger | ◐ | Batch estimates, Brain spend, contact-form costs; no single ledger per lead / campaign |
| Seller knowledge base | ◐ | Brand Brain reads a client's website for social posts; not used for outreach |

### Ideas worth considering (first pass, for discussion)

1. **Reply handling (Brain project 2)**: matches where the market is moving (Artisan, 11x, AiSDR). AiSDR starts it
   switched off until real reply data exists: a good pattern for us too.
2. **Deliverability first**: confirm DKIM in Ongage, tighten DMARC, mailbox health monitoring with automatic pausing
   (Explee, 11x). Every other channel improvement is wasted if emails land in Spam.
3. **Cost per positive reply by segment** (Explee): we already record which email went out, the replies and the spend;
   showing cost per reply per niche / city / offer would tell us where to scale.
4. **An evidence-based opportunity score** (Part III example): build it from what the website check and AI Lookup
   already find (no booking, old site, verified contact, owner known).
5. **Competitor-technology detection** (LeadSwift): our website check already loads each homepage; looking for a
   competing booking widget or platform is a small extension.
6. **Do-not-call registry screening** before real AI calls in the US (a compliance gap the market leaves open).
7. **Meeting booking** as the next win after a reply (a booking link in the conversation).
8. **Seller knowledge base**: reuse Brand Brain so the Brain understands what *we* sell from a URL (Explee's starting
   point).

---

## Add more here

<!-- Next research parts go below, dated. -->
