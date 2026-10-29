# Workflow — Create a month of social posts (Creative Studio)

**Objective:** turn a client's Brand Brain into a month of ready-to-post social creatives (images + captions
for Instagram, Facebook, LinkedIn) that the operator reviews, edits and approves, then downloads as a pack.
Every factual claim in a caption must be traceable to the Brand Brain; nothing unsupported can be approved.

**Owner code:**
- `web/lib/creatives/`: `plans`, `creatives`, `generate`, `render`, `grounding`, `limits`, `edit`, `state`, `cost`, `pack`, `dispatch`, `templates/`.
- `web/app/api/clients/[id]/{plans,creatives,pack}` and `web/app/api/pricing/creatives`: thin routes.
- Dashboard: `/clients/[id]?tab=posts&month=YYYY-MM` (month header, grid, creative view, **Plan a month** wizard).

**Runs on:** Cloud Run `MODE=creative` and `MODE=content-plan` (see Cloud Run modes). Needs a built Brand Brain first (`workflows/build_brand_brain.md`).

**Schema:** migration `047` (content plans, creatives, versions; renders are `brand_assets` rows with `origin = 'render'`).

---

## The three things

| Term | Meaning |
|---|---|
| **Plan** | One client + one month (`YYYY-MM`): platforms, posts per week, featured products, AI backgrounds on/off, a list of **concepts**, and a confirmed cost estimate. Status `draft` / `generating` / `ready`. |
| **Creative** | One post slot in the plan (a date, a template, optionally a product). Single image or a 3-5 slide carousel. Always rendered in three sizes: `1:1` 1080x1080, `4:5` 1080x1350, `9:16` 1080x1920. |
| **Version** | One saved state of a creative: template inputs, per-platform captions + hashtags, the claims it cites, its renders and its grounding verdict. States: `draft` / `approved` / `rejected` / `changes_requested` / `superseded`. Editing a non-draft version makes a new draft and marks the old one `superseded`. |

Templates: **Product hero**, **Offer**, **Tip / quote**, **Customer review**. AI backgrounds default ON for Tip / quote and Offer, OFF for Product hero and Review. The real product or brand photo is never sent to the image AI or altered. Fonts are bundled, so rendering needs no network.

## The wizard (Posts tab, Plan a month)

1. **Setup:** platforms, posts per week (1-7), products to feature, AI backgrounds. The estimate is shown, nothing is spent.
2. **Propose concepts:** one Gemini call returns one concept per slot (title, date, template, product, claims it relies on, CTA). The prompt asks for a **mix** of templates. Edit, remove, add, or retarget any concept (cap `CREATIVE_MAX_PER_PLAN`).
3. **Generate N posts:** shows the estimate (what the button says is what is confirmed). Per post: at most one Gemini copy call (plus one retry) and at most one OpenAI background; then local render of all three sizes. Progress is live; closing the dialog keeps it running.

## Grounding (plain words)

Every caption is checked against the Brand Brain after generation and after every edit.

- **Must be supported:** prices, percentages, years, phone numbers, and claim words such as *guarantee, certified, award, best, #1, only, cheapest, free, since, years, licensed, insured, 24/7, same-day, family-owned, locally*. The copy must cite the Brand Brain fact that backs each one (one fact, not a whole group). A grounded price or percent matches by value.
- **Never allowed:** anything the profile lists as a forbidden claim or a "don't" for the voice.
- **Blocker:** a claim with no supporting fact, a forbidden claim, or a caption over the platform limit (Instagram 2,200 chars / 20 hashtags; Facebook 2,000 / 5; LinkedIn 3,000 / 3). Grounding is not ok; the post cannot be approved.
- **Warning:** the claim matches only a fact the operator has not confirmed yet (for example an AI-drafted fact from a demo site). Grounding stays ok and the post can be approved, but confirm the fact in the Brand Brain.
- To clear a blocker: edit the caption to drop the claim, or add the missing fact to the Brand Brain, then save.

## Review, approval, and what voids it

- Open a creative from the grid. Edit captions, hashtags, template inputs (headline, photo, logo, colours, background prompt). **Save as new version** is free and re-renders locally.
- **Approve** needs all three renders present and grounding ok. **Request changes** (with a note) and **Reject** are also available.
- Any edit after approval creates a new draft and marks the approved version `superseded`: the old approval no longer counts, and the new draft has to be approved again. Regenerating copy or a background also creates a new draft.
- Only `approved` versions go into the pack.

## The pack

**Download pack** (month header; enabled once at least one post is approved) returns a zip: every approved post's PNGs (named `<date>_<title>_<aspect>[_slide-N].png`) plus `captions.csv` (date, platform, caption, hashtags, files). Pack download is free.

## Costs

| Unit | Cost |
|---|---|
| Concepts (once per plan) | one small Gemini call (free tier) |
| Copy per post | about $0.003 (one call, one retry max) |
| AI background per post | `OPENAI_IMAGE_USD_PER_IMAGE` (default $0.053, `gpt-image-2` medium) |
| Edit + Save, Re-render | free (local) |
| Regenerate copy / New background | about $0.003 / about $0.053, asks to confirm |

Typical 12-post month with backgrounds on Tip / quote and Offer: about $0.35-0.70. **Budget hard stop:** `min(confirmed estimate x 1.25, CREATIVE_PLAN_BUDGET_USD)` (default cap $5). If it is hit, generation stops with the remaining posts not yet made (a later Generate resumes them after a fresh confirmation). `GET /api/pricing/creatives` previews an estimate. No paid call runs without an operator action and a shown estimate.

## Config

| Var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | empty | AI backgrounds (empty = backgrounds are skipped; a manual New background errors) |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | image model |
| `OPENAI_IMAGE_QUALITY` | `medium` | `low` / `medium` / `high` |
| `OPENAI_IMAGE_USD_PER_IMAGE` | `0.053` | price used for estimates and job cost |
| `CREATIVE_MAX_PER_PLAN` | `20` | most posts in one plan |
| `CREATIVE_PLAN_BUDGET_USD` | `5` | hard cap of AI spend per plan |

Gemini uses the existing `GOOGLE_GENAI_API_KEY`. Cloud Run gets `OPENAI_API_KEY` as an optional secret from `scripts/deploy-cloud-run-job.sh`.

## Cloud Run modes

```
MODE=creative     CREATIVE_ID=<uuid> [ACTION=all|copy|background|render]   # generate or re-render one post
MODE=content-plan PLAN_ID=<uuid>     ACTION=concepts|generate              # propose concepts / generate the whole month
```

The dashboard triggers these; renders need Chromium, so they run on the job. Locally (dev dispatch renders in-process):

```
cd web
MODE=content-plan PLAN_ID=<uuid> ACTION=concepts npm run run:job
MODE=creative CREATIVE_ID=<uuid> ACTION=render npm run run:job
```

(PowerShell: `$env:MODE="creative"; $env:CREATIVE_ID="<uuid>"; $env:ACTION="render"; npm run run:job`.) `generate` and `copy` / `background` / `all` spend money; confirm first.

## Checklist

- [ ] Client has a built, current Brand Brain with confirmed key facts, products, a logo and photos.
- [ ] `OPENAI_API_KEY` set if backgrounds are wanted; migration 047 applied.
- [ ] Posts tab, pick the month, **Plan a month**, review the estimate, propose, adjust concepts.
- [ ] Generate; wait for progress to finish.
- [ ] Open every post: read the grounding panel, fix blockers, confirm warnings' facts.
- [ ] Edit what needs it, **Save as new version**, wait for the render.
- [ ] Approve the good ones (all three sizes present, grounding ok).
- [ ] **Download pack**, check the PNG count and `captions.csv`, schedule in the platforms.
