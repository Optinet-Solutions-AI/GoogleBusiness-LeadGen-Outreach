# Site Audit Report

**Input:** `pretend business that has no demo`
**Resolution:** lead lookup via `skills/site-auditor/scripts/lookup-lead.ts`
**Result:** STOPPED — no lead matched

## Lookup

Ran the resolver per SKILL.md step 1:

```
NODE_PATH=web/node_modules npx tsx skills/site-auditor/scripts/lookup-lead.ts "pretend business that has no demo"
```

Output:

```
no lead matched: pretend business that has no demo
```

## Status

There is no lead in the database matching the name fragment `pretend business that has no demo`. Because no row was returned, there is no `demo_url` to audit. Per SKILL.md ("If the lookup returns no `demo_url`, tell the operator the lead hasn't been deployed yet and stop — there's nothing to audit"), the audit halts here.

No URL captured. No screenshots taken. No anti-pattern checks run. No fixes applied.

## Next steps for the operator

- Confirm the business name spelling, or
- Provide the lead UUID directly, or
- Provide the deployed `pages.dev` URL directly, or
- If this lead was never scraped, run a batch that captures it first; if it was scraped but not deployed, run stages 3 and 4 to generate and deploy the demo, then re-invoke the auditor.
