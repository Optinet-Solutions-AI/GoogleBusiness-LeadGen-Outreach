# Workflow — Onboard a customer's domain

**Objective:** Get a paying customer's website serving on their custom domain with HTTPS, in under 30 minutes.

This is the internal SOP. The customer-facing pitch lives at [`docs/customer/domain_proposal.md`](../docs/customer/domain_proposal.md) — send that first.

---

## Inputs from the customer

Pick one path:

| Customer answer | What you need from them |
|---|---|
| "I already own a domain" | The domain name + registrar login (read-only OK) OR they update DNS themselves |
| "Buy one for me" | Their preferred name + 2–3 alternates, billing details (or we eat the $11) |
| "I have it but want you to manage everything" | Transfer to Cloudflare Registrar (free, at-cost renewals) |

---

## Path A — Customer already owns the domain (registrar = NOT Cloudflare)

1. **Add the domain to our Cloudflare Pages project.**
   ```bash
   curl -X POST http://localhost:3000/api/leads/<id>/handover \
       -H "Content-Type: application/json" \
       -d '{"mode":"attach","custom_domain":"joesplumbingatx.com"}'
   ```
   The response includes the DNS record they need to add.

2. **Send them this template message:**
   ```
   To make your site live, add ONE record to your domain's DNS:

     Type:   CNAME
     Name:   @       (or "joesplumbingatx.com" depending on your registrar's UI)
     Value:  <slug>.pages.dev
     TTL:    Auto

   Plus one more for the www version:

     Type:   CNAME
     Name:   www
     Value:  <slug>.pages.dev
     TTL:    Auto

   That's it. SSL turns on automatically in about 5–10 minutes after you save.
   ```

3. **Verify in 10 minutes** at `https://joesplumbingatx.com` — should serve the site, padlock should be green. If 404 or "this site can't be reached," DNS hasn't propagated yet — wait.

4. **Mark `lead.stage = 'handed_over'`** (the API call already did this). Update notes with the launch date.

---

## Path B — Customer's domain is already on Cloudflare DNS

Easiest case. Cloudflare Pages auto-detects the domain is on the same account.

1. Same `POST /api/leads/<id>/handover` call.
2. SSL provisions immediately (Cloudflare doesn't wait for DNS — it's already there).
3. **No DNS changes needed** if Pages handles it via "internal route" — verify with `dig joesplumbingatx.com` to confirm.

---

## Path C — We register a new domain for the customer

1. Use **Cloudflare Registrar** (`https://dash.cloudflare.com/{account}/registrar`) — at-cost pricing, no markup, no fake renewal-rate trick.
2. Register under **the customer's name + email** as the registrant. We can be the technical contact. **Never register under our company name** — they own the domain.
3. After registration, the domain is auto-on Cloudflare DNS. Then run Path A → step 1 (which is now Path B's no-DNS-change variant).
4. Send the customer a confirmation: *"You now own `joesplumbingatx.com` — receipts will come from Cloudflare to your inbox once a year. Renewal is currently $X."*

---

## Path D — Customer wants to migrate from a different host (e.g. WordPress)

1. **Don't touch their old site yet.** Keep it live during the build/improve phase.
2. After the customer signs off on the new site, schedule a **launch window** (10 minutes, ideally weekday morning).
3. During the window:
   - Add the domain to our Pages project (Path A step 1).
   - Update their DNS records to point at us.
   - Their old host serves the old site for ~5 minutes during DNS propagation; new visitors hit ours.
   - Lighthouse-test the new site immediately (Path 1 verification below).
4. **Set up 301 redirects from old URLs** if their old site had specific paths Google indexed. Use Cloudflare Page Rules or a `_redirects` file in `public/`.
5. Tell the customer the old WordPress site can be cancelled at the next billing date.

---

## After launch — verify

- [ ] `https://yourdomain.com` resolves; padlock is green
- [ ] `https://www.yourdomain.com` redirects or also serves
- [ ] PageSpeed mobile + desktop ≥ 95 on `/` and `/services/<slug>`
- [ ] `sitemap-index.xml` accessible at `https://yourdomain.com/sitemap-index.xml`
- [ ] `robots.txt` accessible
- [ ] [Google Search Console](https://search.google.com/search-console) — add the property, submit the sitemap
- [ ] [Google Business Profile](https://www.google.com/business/) — update the business's website field to the new domain
- [ ] Lead.stage = `handed_over`; lead.custom_domain = the domain

---

## Common breakages

| Symptom | Cause | Fix |
|---|---|---|
| "This site can't be reached" 1+ hours after DNS change | Customer added the record under wrong domain or with TTL way too high | Re-check the DNS panel; lower TTL; tell them to be patient (some ISPs cache 24h) |
| "Your connection is not private" (SSL warning) | Cloudflare is still provisioning the cert | Wait. If still failing after 1 hour, remove + re-add the domain in Pages |
| Site loads but missing CSS / images | Cached old `pages.dev` URL with absolute paths | Force refresh; if persistent, rebuild with `SITE_URL=https://yourdomain.com` |
| Email stops working at the domain | DNS records for email were overwritten | Restore the customer's MX records; **never** delete records you didn't add |

---

## Don't

- Don't register a domain under your name "to make it easier." It looks like a hostage situation later. Always register in the customer's name.
- Don't auto-renew their domain on your card unless they explicitly ask — they'll forget and dispute the charge.
- Don't skip the 301 redirects when migrating. Their old Google rankings die otherwise.
- Don't go live on a Friday afternoon. Launch on a weekday morning so you're around if something breaks.
