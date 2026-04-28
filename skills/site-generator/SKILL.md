---
name: site-generator
description: Generate or regenerate ONE demo site for a single lead. Use when the operator wants to test a template change, debug why a specific site looks wrong, or hand-tune a demo before sending.
---

# site-generator

## When invoked

1. Ask the operator for the `lead_id` (UUID).
2. Read the lead from DB:
   ```sql
   select * from leads where id = '<lead_id>';
   ```
3. Show the operator the lead's stage and key fields (business_name, brand_color, photos count, reviews count, email).
4. If the operator wants to regenerate, use the API (fire-and-forget):
   ```bash
   curl -X POST http://localhost:3000/api/leads/<lead_id>/regenerate \
       -H "Content-Type: application/json" \
       -d '{"from_stage":"generate"}'
   ```
   To include redeploy too: `{"from_stage":"generate"}` already runs generate → deploy → outreach in order. Use `"from_stage":"deploy"` to skip the Claude regeneration.
5. Gemini 2.5 Flash is free up to 1,500 req/day — surface the remaining-quota concern only if today's pipeline runs are stacking.
6. After build, open the dist locally so they can preview:
   ```bash
   npx serve .tmp/generated-sites/<slug>/dist
   ```

## Debugging template issues

If the site looks wrong:
- Check `templates/<slug>/src/data.json` — does the data look right?
- Check the Astro components reference correct field names.
- Check `lead.brand_color` — bad hex breaks Tailwind.
- Check `lead.photos` URLs are still alive (Google signed URLs expire).

Reference: `workflows/generate_demo_site.md`.

## Don't
- Don't regenerate every site in a batch one-by-one. Use `pipeline-runner` for that.
- Don't edit the live deployed site — push a new deploy.
