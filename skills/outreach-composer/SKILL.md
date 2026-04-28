---
name: outreach-composer
description: Draft, review, or refine cold-email sequences for the Instantly campaign. Use when the operator says things like "write the cold email", "tighten the day-3 follow-up", "this sequence isn't getting replies".
---

# outreach-composer

## Constraints
- Voice: warm, concrete, direct. No "I hope this finds you well." No buzzwords.
- Length: opener ≤ 90 words. Follow-ups ≤ 60 words.
- Personalization: must reference the demo URL and **one** specific business detail (their actual review, their photo, their service area).
- CTA: "Want me to keep it live?" or similar — low-friction yes/no.

## When invoked

1. Ask the operator: which step of the sequence (Day 0 opener, Day 3 follow-up, Day 7 close)?
2. Show 2 variants (A/B). Don't write 5 — choose carefully.
3. Use Instantly merge tags exactly:
   - `{{first_name}}`
   - `{{company_name}}`
   - `{{custom_variables.demo_url}}`
4. After draft, print a checklist:
   - [ ] Subject < 50 chars
   - [ ] No buzzwords
   - [ ] References one specific business detail
   - [ ] Single CTA
   - [ ] Mobile-friendly (one short paragraph per beat)

## Don't
- Don't write generic "I noticed your business..." templates. They go to spam.
- Don't add image attachments — kills deliverability.
- Don't pitch features. Pitch the demo URL.
