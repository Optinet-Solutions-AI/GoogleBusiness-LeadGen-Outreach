import { config as loadEnv } from "dotenv"; import path from "node:path"; import fs from "node:fs";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
import { renderSequenceEmail } from "@/lib/email/sequence-templates";
import { spamCheck } from "@/lib/email/spam-check";

// Several businesses so the per-business variation is visible (each lands on a
// different intro/follow-up). Two emails only: intro + one final follow-up.
const leads = [
  { business_name: "Chelsea's Kitchen", call_segment: "has_website", demo_url: null },
  { business_name: "Bright Smile Dental", call_segment: "has_website", demo_url: null },
  { business_name: "Summit Auto Repair", call_segment: "has_website", demo_url: null },
];
const DAYS = { 1: "Day 0 · intro", 2: "Day 4 · follow-up (final)" } as const;

const blocks = leads.map((lead) => {
  const cards = ([1, 2] as const).map((step) => {
    const r = renderSequenceEmail(lead, step);
    const s = spamCheck(r.subject, r.html);
    const spamLine = s.level === "low" ? "spam-risk: low ✓" : `spam-risk: ${s.level} — ${s.flags.join("; ")}`;
    return `<div class="card">
      <div class="meta"><b>${DAYS[step]} · Step ${step}</b> &nbsp;·&nbsp; to: ${lead.business_name}
        &nbsp;·&nbsp; screenshot:${r.useScreenshot} link:${r.useLink} &nbsp;·&nbsp; ${spamLine}</div>
      <div class="subj">Subject: ${r.subject}</div>
      <div class="body">${r.html}</div>
    </div>`;
  }).join("\n");
  return `<h2 style="font-size:16px;margin-top:28px">${lead.business_name}</h2>${cards}`;
}).join("\n");

const html = `<!doctype html><meta charset="utf-8"><title>Services sequence preview</title>
<div style="font-family:system-ui;max-width:680px;margin:32px auto;color:#111">
<h1 style="font-size:20px">AI-services outreach (has_website)</h1>
<p style="color:#666">For businesses that already have a good website. Two emails only: an intro and one follow-up that says it's the last. Pitches an AI assistant, never the website. Note how each business gets different copy.</p>
${blocks}
</div>
<style>.card{border:1px solid #ddd;border-radius:10px;padding:18px 22px;margin:12px 0;background:#fff}
.meta{font-size:12px;color:#888;margin-bottom:8px}.subj{font-weight:700;margin-bottom:10px}
.body{font-size:15px;line-height:1.5}.body p{margin:0 0 10px}</style>`;
const out = path.resolve(process.cwd(), "..", ".tmp", "services-sequence-preview.html");
fs.writeFileSync(out, html, "utf8");
console.log(out);
