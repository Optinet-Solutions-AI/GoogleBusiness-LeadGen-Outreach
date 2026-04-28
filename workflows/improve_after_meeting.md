# Workflow — Improve a site after the meeting

**Objective:** Replace placeholder/Maps-derived data with the customer's real data, regenerate the multi-page site, and redeploy. Lead → `improved`.

## Why this exists
- Maps photos are sometimes unflattering; customers send better.
- Service area (Maps category is too vague) gets named cities.
- Business hours get filled in (Maps Pro tier doesn't return them).
- Gemini-written copy gets human edits.
- Most importantly: this puts us off Google's 30-day storage limit because the site is now driven by **customer-supplied data**, not Maps content.

## Inputs
- Lead at `stage = 'meeting_done'` (or `meeting_booked` — the API doesn't gate on stage).
- Customer-supplied: photos (URLs they emailed, or you uploaded), service-area cities, hours, copy edits.

## Steps

1. **Collect their material.**
   - Photos: ask them to email 3–10 high-res images. Upload to Cloudflare Images / R2 / a public bucket so each has a URL.
   - Service area: a list of cities they'll travel to.
   - Hours: 7 strings keyed `mon`..`sun`.
   - Copy: any edits to hero/about/per-service text.

2. **Call the improve endpoint.**
   ```bash
   curl -X POST http://localhost:3000/api/leads/<id>/improve \
       -H "Content-Type: application/json" \
       -d '{
         "photos": [
           "https://images.example.com/joe/truck.jpg",
           "https://images.example.com/joe/install.jpg"
         ],
         "service_areas": ["South Austin","Bouldin","Zilker","Round Rock"],
         "business_hours": {
           "mon":"7:00am – 6:00pm","tue":"7:00am – 6:00pm","wed":"7:00am – 6:00pm",
           "thu":"7:00am – 6:00pm","fri":"7:00am – 6:00pm",
           "sat":"8:00am – 2:00pm","sun":"Emergency only"
         },
         "copy": {
           "hero_tagline": "South Austin’s pipes, sorted.",
           "services": [
             { "slug":"emergency-repairs","name":"Emergency repairs",
               "short_description":"Same-night response.",
               "detail_paragraph":"...","bullets":["...","..."] }
           ]
         },
         "notes": "Customer asked us to drop tankless install service."
       }'
   ```
   Returns `202` immediately. The pipeline:
   - patches photos / service_areas / business_hours / brand_color / notes onto the lead row
   - re-runs Gemini (operator overrides win)
   - rebuilds Astro (multi-page)
   - redeploys to the same Cloudflare Pages project
   - flips lead → `improved`

3. **Verify.**
   - Open `lead.demo_url` (still `<slug>.pages.dev`) — same URL, fresh content.
   - Spot-check `/`, `/about`, `/services`, `/services/<slug>`, `/service-area`, `/contact`.

4. **Send for approval** before handover. Once they sign off, run the handover workflow.

## Cost
- One Gemini call (~free tier)
- One Cloudflare deploy (free)
- ~30s end-to-end

## Don't
- Don't run `improve` to fix tiny typos — `PATCH /api/leads/<id>` then `POST /api/leads/<id>/regenerate` is cheaper.
- Don't include `email` or `phone` in copy overrides — those are root fields on the lead.
