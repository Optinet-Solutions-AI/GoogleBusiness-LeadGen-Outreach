# Workflow — Hand the site over to the client

**Objective:** Move the lead to `handed_over` with their custom domain serving the site (or, less ideal, transfer the project entirely).

## Two modes

### Mode A — `attach` (recommended)
Same Cloudflare Pages project, customer's domain pointed at it. **We retain ownership and recurring hosting fee.**

### Mode B — `transfer` (rare)
Cloudflare Pages does not expose a project-transfer API. Marking `transfer` is record-keeping only — the actual transfer is manual in the Cloudflare dashboard. **Lose recurring revenue.** Avoid unless the customer insists.

## Mode A — Attach

**Inputs**
- Lead at `stage = 'improved'` (or `meeting_done`).
- Customer's domain (theirs, or you registered it on their behalf at Cloudflare Registrar).

**Steps**

1. **Make sure DNS is at Cloudflare** for the domain (or that the customer can add records).

2. **Attach via the API.**
   ```bash
   curl -X POST http://localhost:3000/api/leads/<id>/handover \
       -H "Content-Type: application/json" \
       -d '{"mode":"attach","custom_domain":"joesplumbingatx.com"}'
   ```
   Response includes `dns_instructions`:
   ```json
   {
     "lead_id": "...",
     "mode": "attach",
     "custom_domain": "joesplumbingatx.com",
     "dns_instructions": [
       { "type": "CNAME", "name": "joesplumbingatx.com", "value": "<slug>.pages.dev" }
     ]
   }
   ```

3. **Set the DNS records** (only needed if the domain is hosted *outside* Cloudflare):
   - For the apex (`joesplumbingatx.com`): use Cloudflare's CNAME flattening or A/AAAA records to Cloudflare's IPs.
   - For `www.`: add a `CNAME www → <slug>.pages.dev`.

4. **Wait for SSL.** Cloudflare provisions a cert automatically — usually 1–3 minutes, occasionally up to an hour for fresh domains.

5. **Verify.**
   - `https://joesplumbingatx.com` should serve the site.
   - `<slug>.pages.dev` continues to work (used by the orchestrator for redeploys).

6. **Update outreach assets** — the cold-email link, signature, etc. now point at the customer's domain.

7. **Subscribe them in Stripe** (TODO when billing goes live).

8. Lead is now `handed_over`. Manually flip to `closed_won` once payment clears.

## Mode B — Transfer (manual)

1. Call the API with `{"mode":"transfer"}` so the lead gets logged.
2. In the Cloudflare dashboard, transfer the Pages project to the customer's account (Settings → Members & access). They must accept the transfer email.
3. After acceptance, **we no longer have access**. Drop the lead from any pipeline jobs that touch this slug.

## Don't
- Don't attach a domain before the customer has paid the setup fee.
- Don't transfer the project unless billing is one-time only and you've documented it.
- Don't share API tokens with the customer to "let them attach themselves" — they'd see every other site.
