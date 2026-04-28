# Stitch prompt — Operator dashboard for the lead-gen pipeline

> Paste everything between the `--- BEGIN PROMPT ---` and `--- END PROMPT ---` markers into [Stitch](https://stitch.withgoogle.com) as your initial prompt. Iterate by saying "change [page] to …" once you have an initial design.
>
> **What this is for:** The internal dashboard that fronts the API at `web/app/api/*` in this repo. Stitch's output is a *design reference* (HTML/CSS or Figma) — port the resulting screens into React components under `web/app/` using Tailwind utility classes.

---

## How to use

1. Open Stitch, start a new project.
2. Paste the prompt below (it's self-contained — context, pages, components, sample data).
3. Stitch will generate the 5 screens. Browse, mark what you like.
4. Iterate per page: *"On the Batches page, make the new-batch button stickier"*, *"On the Lead detail page, move the timeline above the form"*, etc.
5. Export the result. Translate the screens into React components under `web/app/(dashboard)/`. Components map 1:1 — `<BatchTable>`, `<NewBatchModal>`, `<StageFunnel>`, `<LeadTimeline>`.
6. Wire each component to the existing endpoints (see [`web/README.md`](../../web/README.md) for the API contract).

## Iteration tips for Stitch

- *"Make the table denser"* — Stitch defaults to roomy SaaS-marketing density; force it tighter
- *"Use Tailwind classes, not inline styles"*
- *"No decorative illustrations"* — operator tool, not a homepage
- *"Match Linear's empty states: one verb, one icon"*
- *"Show loading states explicitly"* — Stitch otherwise hand-waves async UI

---

## --- BEGIN PROMPT ---

```
Build a 5-page operator dashboard for an internal B2B lead-generation tool.

# Project context

The tool runs a 5-stage automated pipeline:
  1. Scrape Google Maps for local businesses without websites
  2. Enrich each lead with photos and brand color
  3. Generate a personalized multi-page demo website using AI copy
  4. Deploy each demo to its own subdomain on Cloudflare Pages
  5. Send a personalized cold email with the demo URL

After outreach, the lead lifecycle continues:
  replied → meeting_booked → meeting_done → improved → handed_over → closed_won

The dashboard's user is ONE operator (a salesperson) who runs many batches per
week, triages replies, runs meetings, and hands sites over to paying customers.

This is a TOOL, not a website. Optimize for information density, speed of
action, and operator focus.

# Visual style

Reference apps: Linear, Cron, Vercel's project dashboard, Notion's data tables.

  - Light mode ONLY (operators work in bright conditions)
  - Tailwind CSS conventions — use utility classes (text-sm, text-slate-600,
    rounded-lg, divide-y, etc.)
  - Inter or system-ui sans-serif. No display fonts.
  - Single accent color for primary actions: deep navy #1F4E79
  - Status colors: green (success), amber (warning), rose (error), slate (neutral)
  - Border radius: lg (8px) for cards, full for chips/buttons
  - NO decorative illustrations, stock photos, gradients, or hero sections
  - NO 3D, glassmorphism, neumorphism, or other ornamental treatments
  - Density: like a dev tool. ≥30 rows visible per screen on a 13" laptop.

# Layout shell (every page)

Top bar:
  - Left: brand mark — small navy square + "Pipeline" wordmark in 14px semibold
  - Right: 2 chips → "Week 17" (current ISO week) and "$3.40 spent today"
  - Single horizontal line below

Side nav (left, 200px wide, sticky):
  - "Batches"  (icon: rows)         → /
  - "Leads"    (icon: user)         → /leads
  - "Replies"  (icon: chat-dot)     → /replies   with red dot when count > 0
  - "Status"   (icon: chart-line)   → /status
  - Active item: navy left border + slate-900 text. Inactive: slate-600.

Main content: rest of width, 24px padding, max-width 1400px.

# Page 1 — / (Batches list, home)

Headline row:
  - "Batches" (h1, 24px semibold)
  - Right side: primary button "+ New batch" (navy bg, white text, lg radius)
  - Below headline: filter pills [All • Running • Done • Failed], total count

Table (dense, sticky header, divide-y slate-200, no zebra):
  Columns:
    - Niche / City (combined: "Plumber · Austin, TX")
    - Scraper (chip: "Google Places" navy outline / "Outscraper" amber outline)
    - Status (chip: queued slate / running blue + spinner / done green / failed rose)
    - Stage funnel: tiny horizontal bar showing N leads at each stage
      (scraped → enriched → generated → deployed → outreached). Color the
      furthest filled segment in navy.
    - Replies count (small green pill if > 0, else "—")
    - Est. cost ("$2.40")
    - Created (relative: "12m ago")
  - Whole row clickable → /batches/[id]
  - Right side of each row: ⋯ menu with [View, Re-run, Delete]
  - Empty state: centered "No batches yet — create your first one" with the
    same primary "+ New batch" button beneath. NO illustration.

# Page 2 — /batches/[id] (Batch detail)

Header:
  - Breadcrumb: "Batches /" then niche + city as h1
  - Right side: status chip + "Re-run" secondary button
  - Below: 4 stat cards in a row — Total leads, Qualified, Deployed, Replies

Stage funnel (full width below stats):
  - Visualize the 7 stages as a horizontal step bar with counts:
    scraped 47 → enriched 47 → generated 38 → deployed 38 → outreached 35 → replied 4 → meeting_booked 1
  - Each step a navy block sized proportionally to count. Hover shows full label.

Lead table (below funnel):
  Columns:
    - Business name + small gray subtext (city)
    - Stage chip (color-coded per stage value)
    - Email (or italic gray "needs email" with inline edit pencil)
    - Demo URL (truncated, copy button on hover)
    - Last error (red text if present, else "—")
  - Filter chips at top: [All • needs_email • replied • dead]
  - Click row → /leads/[id]
  - Empty state: "No leads scraped yet."

# Page 3 — /leads/[id] (Lead detail)

This page is dense — 2-column layout on desktop, stacked on mobile.

LEFT column (60% width):
  Section 1 — Identity card:
    - Business name (h1, 24px)
    - Phone, address, category — each as a labeled row
    - Star rating + review count
    - Brand color swatch (24x24 circle) + hex
    - "Open demo →" button (large, navy) → opens lead.demo_url in new tab

  Section 2 — Stage timeline (vertical):
    - Each stage that has fired = a node with the stage name, timestamp,
      and any meta (e.g. "deployed: joes-plumbing.pages.dev")
    - Future stages = greyed out
    - Errors shown inline at the failed stage in rose

  Section 3 — Outreach events log:
    - Append-only list of events: email_sent, email_opened, replied,
      email_bounced
    - Each: icon + kind + time + provider snippet expanded on click

  Section 4 — Operator notes:
    - Editable textarea, autosaves on blur
    - Recent notes timestamped above the textarea

RIGHT column (40% width, sticky):
  Section A — Contact:
    - Email (editable inline) — pencil icon → input → enter to save
    - "Send to outreach" button if email is missing

  Section B — Meeting:
    - Two buttons: "Mark booked" / "Mark done"
    - Notes textarea posts to /api/leads/:id/meeting

  Section C — Improve site:
    - "Open improve modal" → modal with:
      • Photos (drag-to-add URLs, paste-multiline-supported)
      • Service areas (chip input, comma-or-newline separated)
      • Business hours (7 fields keyed mon..sun)
      • Brand color (color picker)
      • Copy overrides (collapsible textarea per field)
    - Save → POST /api/leads/:id/improve → toast "Rebuilding... ~30s" →
      poll lead until stage='improved'

  Section D — Hand over:
    - Two buttons:
      • "Attach domain" (primary) → modal asks for domain → POST /handover
        with mode=attach. Response renders the DNS record they need to set.
      • "Mark transferred" (ghost) → confirmation → POST with mode=transfer
    - Once handed over, both buttons disabled, replaced by "Domain attached:
      joesplumbing.com (live ✓)"

  Section E — Danger zone (collapsed by default):
    - "Mark closed_won / closed_lost / dead" buttons

# Page 4 — /replies (Reply inbox)

This is where the operator triages replies. It's the most-visited page.

Layout: master-detail (two columns).

LEFT column (40%, list):
  - Filter chips: [All • Unread • Today]
  - Each row:
    - 1st line: business name (semibold)
    - 2nd line: first 80 chars of last reply (slate-600)
    - Right side: time-ago + an unread dot
  - Selected row gets navy left border
  - Empty: "No replies yet — patience pays"

RIGHT column (60%, detail):
  - Top: business name, demo URL, phone, "Open lead detail →" link
  - Below: thread of outreach_events with kind=email_replied, newest first,
    full body of each reply
  - Bottom action bar (sticky):
    - "Mark booked" → opens meeting modal
    - "Mark dead" → confirmation
    - "Open lead" → /leads/[id]

# Page 5 — /status (Weekly status)

Operator's weekly view — pulls from docs/status/YYYY-Www.md AND from the DB.

Top: ISO week selector (default current). Left arrow, "Week 2026-W17", right arrow.

Big numbers row (4 cards):
  - Leads scraped this week
  - Sites deployed
  - Emails sent
  - Replies received

Below: 3-column grid:
  - "Done" — bullets pulled from docs/status/[week].md "Done" section
  - "In progress" — from same file
  - "Blocked" — from same file
  - Each pulls the markdown file content; if missing, show "Generate weekly
    update" button → POST /api/status/generate (TODO)

Bottom: "Daily log" — collapsible per day, latest at top.

# Modals

## "New batch" modal (opens from "+ New batch" button)

Trigger: "+ New batch" on the / page.

Content (centered card, 480px wide):
  - Header: "New batch"

  - Form fields:
    1. Niche (text input, placeholder "plumber, salon, restaurant…")
    2. City (text input, placeholder "Austin, TX")
    3. Template (select: trades / food-beverage / beauty-wellness)
    4. Limit (slider 1–500, default 100, value shown next to label)

  - SCRAPER TOGGLE (the most important interaction in the dashboard):
    Two equal buttons side-by-side, full width of modal:
      [ Google Cloud Places ]  [ Outscraper ]
    Selected button: navy bg + white text + checkmark icon.
    Unselected: slate-100 bg + slate-700 text.
    Below the toggle: small slate-500 caption that reads either:
      "Default. Free tier covers ~5,700 leads/mo."  (when Places selected)
      "$3 per 1,000 leads. Used at scale."          (when Outscraper selected)

  - LIVE COST CHIP (renders below the toggle, updates on every change):
    GET /api/pricing/estimate?scraper=...&limit=... on every toggle/slider event
    Shows in a slate-50 card:
      "Estimated cost: $2.40"
      "60 leads after cap (was 100)"   ← only when limit > scraper cap
    If warnings array non-empty, list them in amber italic.

  - Footer buttons:
    [ Cancel (ghost) ]  [ Run batch (navy primary) ]

## "Improve" modal — see Page 3, Section C above
## "Attach domain" modal — see Page 3, Section D above

# Components to design (reusable)

  - StageChip: chip whose color maps to one of these stage values:
    scraped (slate), enriched (slate), generated (blue), deployed (cyan),
    outreached (indigo), needs_email (amber), replied (green),
    meeting_booked (violet), meeting_done (violet),
    improved (cyan), handed_over (emerald),
    closed_won (emerald solid), closed_lost (rose), dead (slate-400)
  - StageFunnel: horizontal stacked bar showing counts per stage in a batch
  - CostChip: small slate-50 card with "$X.XX" + optional warnings list
  - ScraperToggle: two-button group with live cost preview underneath
  - StatCard: number + label + tiny delta-vs-last-week
  - Toast: bottom-right, slate-900 bg, white text, auto-dismiss 4s
  - ConfirmDialog: slate-50 card, primary action in rose for destructive

# Sample data (use this in your designs — not generic placeholders)

Batches list:
  [
    { id: "a", niche: "plumber", city: "Austin, TX", scraper: "google_places",
      status: "running", limit: 100, est_cost: 2.40, created_at: "12m ago",
      stage_counts: { scraped: 47, enriched: 41, generated: 22, deployed: 18,
                      outreached: 12, replied: 1 } },
    { id: "b", niche: "salon", city: "Phoenix, AZ", scraper: "outscraper",
      status: "done", limit: 200, est_cost: 1.10, created_at: "yesterday",
      stage_counts: { scraped: 200, enriched: 198, generated: 73, deployed: 73,
                      outreached: 73, replied: 4, meeting_booked: 2 } },
    { id: "c", niche: "electrician", city: "Tampa, FL", scraper: "google_places",
      status: "failed", limit: 60, est_cost: 0, created_at: "2 days ago",
      stage_counts: { scraped: 0 } },
  ]

Lead detail:
  {
    business_name: "Joe's Plumbing",
    phone: "(512) 555-0142",
    address: "1200 S Lamar Blvd, Austin, TX 78704",
    category: "Plumber",
    rating: 4.8, review_count: 142,
    brand_color: "#1F4E79",
    email: "joe@joesplumbingatx.com",
    stage: "replied",
    demo_url: "https://joes-plumbing.pages.dev",
    notes: "[2026-04-28T14:00] (replied) Sounded warm. Wants to see\nmobile preview before booking.",
    photos: ["https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=1600"],
    service_areas: ["South Austin", "Bouldin", "Zilker"],
    business_hours: { mon: "7am-6pm", tue: "7am-6pm", wed: "7am-6pm",
                      thu: "7am-6pm", fri: "7am-6pm", sat: "8am-2pm",
                      sun: "Emergency only" }
  }

Pricing estimate response:
  {
    scraper: "google_places",
    requested_limit: 100,
    effective_limit: 60,
    estimated_qualifying: 15,
    total_usd: 2.40,
    breakdown: [
      { item: "Google Places Text Search (Pro)", qty: 60, unit_usd: 0.035, cost_usd: 2.10 },
      { item: "Gemini API (site copy, free tier)", qty: 15, unit_usd: 0.02, cost_usd: 0.30 }
    ],
    warnings: ["limit 100 exceeds Google Places per-query cap (60)"]
  }

# Out of scope (do not design)

  - Marketing landing page or homepage — this is internal-only
  - Sign-up / login / password reset flows
  - Settings page — env vars are managed in Vercel, not in-app
  - Any pricing page for end-customers
  - Mobile-first design — operators use a laptop. Responsive down to 1024px
    is enough; below that show "Open on a laptop" message

# Done = these 5 pages plus 3 modals and the listed reusable components

Each page should be designed for a 1440-wide laptop, with a graceful 1024
breakpoint (single-column main, side nav collapses to icons).
```

## --- END PROMPT ---

---

## After Stitch generates the design

The output ports to **`web/app/(dashboard)/`** like this:

```
web/app/(dashboard)/
├── layout.tsx                 ← top bar + side nav (shared)
├── page.tsx                   ← Batches list
├── batches/
│   ├── new/page.tsx           ← New batch modal becomes a route here too
│   └── [id]/page.tsx          ← Batch detail
├── leads/
│   ├── page.tsx               ← Optional standalone leads list
│   └── [id]/page.tsx          ← Lead detail
├── replies/page.tsx
└── status/page.tsx

web/components/
├── StageChip.tsx
├── StageFunnel.tsx
├── ScraperToggle.tsx
├── CostChip.tsx
├── StatCard.tsx
├── Toast.tsx
└── ConfirmDialog.tsx
```

Each component fetches from the existing API directly:
- `<BatchTable>` → `GET /api/batches`
- `<NewBatchModal>` → `POST /api/batches` + `GET /api/pricing/compare?limit=N`
- `<LeadDetail>` → `GET /api/leads/[id]` + edit/improve/handover/meeting endpoints
- `<RepliesInbox>` → `GET /api/leads?stage=replied`

## Faster alternatives if Stitch isn't producing what you want

| Tool | Pros | When to use |
|---|---|---|
| **v0.dev** (Vercel) | Generates working React + Tailwind code (not just a design); can iterate by chat | If you want code, not a static design |
| **Lovable** | Builds full apps including data layer | Overkill for a design pass |
| **Cursor + Claude Code** | Apply this same prompt directly in the editor; the AI writes the React components in-place | If you want maximum context-awareness with the existing repo |

The same prompt works in v0.dev with one tweak: replace *"Build a 5-page operator dashboard"* with *"Build a 5-page operator dashboard as a React + Tailwind app using Next.js App Router conventions."*
