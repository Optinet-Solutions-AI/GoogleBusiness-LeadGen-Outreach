/**
 * config.ts — Loads + validates env vars into a typed `env` object.
 *
 * Inputs:  process.env (loaded from .env at repo root by Next + tsx)
 * Outputs: `env` singleton imported everywhere
 * Used by: every module that touches an external service or the DB
 */

import { z } from "zod";
import { config as loadDotenv } from "dotenv";
import path from "node:path";

// .env lives at the REPO root, not inside web/. Next.js by default only
// reads .env from the project (web/) folder, so we explicitly pull the
// repo-root file here. Idempotent — running it twice is harmless.
loadDotenv({ path: path.resolve(process.cwd(), "../.env") });
loadDotenv({ path: path.resolve(process.cwd(), ".env") }); // fallback if .env IS in web/

const Schema = z.object({
  // Runtime
  APP_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Supabase
  SUPABASE_URL: z.string().default(""),
  SUPABASE_SERVICE_KEY: z.string().default(""),
  SUPABASE_ANON_KEY: z.string().default(""),

  // Scraping providers (one of these is required at run time, not at import time)
  OUTSCRAPER_API_KEY: z.string().default(""),
  GOOGLE_PLACES_API_KEY: z.string().default(""),
  GOOGLE_PLACES_DEFAULT_REGION: z.string().default("us"),
  GOOGLE_PLACES_DEFAULT_LANGUAGE: z.string().default("en"),

  // Apify — Google Maps scraper that also website-crawls emails + social links (FB/IG).
  // Async "actor" API; token from https://console.apify.com/settings/integrations. Empty = disabled.
  APIFY_TOKEN: z.string().default(""),

  // Google Gemini (site copy generation — uses the free tier on your GCP project)
  // Get a key at: https://aistudio.google.com/app/apikey  (separate from the Places key)
  GOOGLE_GENAI_API_KEY: z.string().default(""),
  GOOGLE_GENAI_MODEL: z.string().default("gemini-2.5-flash"),

  // Google Custom Search API — finds Facebook + Instagram URLs for leads
  // when Google Places didn't surface one. Headless-browser search engines
  // all CAPTCHA us; the official API is the only stable free-tier path.
  // Setup:
  //   1. Enable Custom Search API at
  //      https://console.cloud.google.com/apis/library/customsearch.googleapis.com
  //   2. Create a Programmable Search Engine at
  //      https://programmablesearchengine.google.com/  — scope it to
  //      facebook.com + instagram.com (one entry per site).
  //   3. The "Search engine ID" (cx) goes in GOOGLE_CSE_ID.
  //   4. Reuse GOOGLE_PLACES_API_KEY here if it's unrestricted, else
  //      create a new API key with Custom Search API enabled.
  // Quota: 100 queries/day free, then $5/1000 queries. Each lead uses up
  // to 2 queries (FB + IG in parallel). Soft-fails to null when missing.
  GOOGLE_CSE_API_KEY: z.string().default(""),
  GOOGLE_CSE_ID: z.string().default(""),

  // Residential proxy — Playwright fetches FB/IG profile pages through this
  // because Cloud Run's egress IPs are on FB+IG's bot block list (verified:
  // every direct request returns login_wall or no_og_image). Residential
  // IPs blend with normal user traffic and return real og:image content.
  //
  // PROXY_USERNAME_TEMPLATE accepts a "{COUNTRY}" substring that's replaced
  // per-request with the lead's batch country_code (uppercased). Falls back
  // to PROXY_DEFAULT_COUNTRY when the lead has no country attached.
  //
  // All four empty → no proxy (direct fetch). Each is independently sized
  // so config.ts doesn't gate on partial setup.
  PROXY_SERVER: z.string().default(""),
  PROXY_USERNAME_TEMPLATE: z.string().default(""),
  PROXY_PASSWORD: z.string().default(""),
  PROXY_DEFAULT_COUNTRY: z.string().default("us"),

  // Cloudflare Pages
  CLOUDFLARE_API_TOKEN: z.string().default(""),
  CLOUDFLARE_ACCOUNT_ID: z.string().default(""),
  CLOUDFLARE_PAGES_ROOT_DOMAIN: z.string().default(""),

  // Cloud Run Jobs (the Vercel route handler triggers a Job execution
  // instead of running the orchestrator inline — sidesteps the 60s Vercel
  // function cap). Auth via Workload Identity Federation: Vercel's per-
  // invocation OIDC token is exchanged at GCP STS for a short-lived access
  // token. No long-lived JSON keys. All five are required; if any are
  // missing the route falls back to the inline `waitUntil` path.
  GCP_PROJECT_ID: z.string().default(""),
  GCP_REGION: z.string().default("us-central1"),
  CLOUD_RUN_JOB_NAME: z.string().default("lead-batch-runner"),
  // Full resource path:
  //   projects/<num>/locations/global/workloadIdentityPools/<pool>/providers/<prov>
  GCP_WORKLOAD_IDENTITY_PROVIDER: z.string().default(""),
  // Email of the SA the federated token impersonates
  // (e.g. vercel-trigger-sa@<project>.iam.gserviceaccount.com)
  GCP_SERVICE_ACCOUNT_EMAIL: z.string().default(""),

  // Brandfetch (logo lookup — graceful no-op when blank, falls back to monogram).
  // Free tier: 1,000 lookups/month. Get a key at https://developers.brandfetch.com/.
  BRANDFETCH_API_KEY: z.string().default(""),

  // ScrapingBee (Google SERP scraper — used as the last-chance fallback in
  // social-search.ts when DDG + slug-guess both fail to surface a valid
  // FB/IG URL). The Google Search endpoint returns structured JSON
  // including the Knowledge Panel's social_profiles[], which is where
  // Google exposes the FB/IG URLs that the Places API hides.
  //
  // Costs ~25 credits per Google search. Free tier = 1,000 credits/month
  // = ~40 searches. Paid tier $49/mo = 150k credits = ~6,000 searches.
  // Empty value = feature disabled (silent skip; fall through to monogram).
  SCRAPINGBEE_API_KEY: z.string().default(""),

  // Instantly (DEPRECATED — email outreach retired in favour of voice calls.
  // Kept so historical needs_email/replied data + the stage-5-outreach module
  // still type-check; not wired into the active pipeline.)
  INSTANTLY_API_KEY: z.string().default(""),
  INSTANTLY_FROM_EMAIL: z.string().default(""),

  // Voice outreach provider. 'manual' (default) = a human reads the generated
  // script and logs the outcome; no external calling. A real provider
  // ('vapi'/'retell'/'bland'/'twilio') implements the VoiceProvider interface
  // in lib/services/voice/ and is selected here when we go live.
  VOICE_PROVIDER: z.enum(["manual", "vapi", "retell", "bland", "twilio"]).default("manual"),

  // Voizo Dial API (AI calls — the "call" campaign channel). Voizo places ONE call per request
  // into a shadow test campaign; we own the queue, retries and follow-up. Empty key = calling off
  // (the call tick no-ops). Workflow: workflows/call_leads_voizo.md.
  //   VOIZO_MAX_ATTEMPTS       — unanswered attempts per lead per campaign before giving up.
  //   VOIZO_RETRY_HOURS        — gap between unanswered attempts.
  //   CALL_TICK_BUDGET_MINUTES — how long one MODE=call run keeps dialling (scheduler fires every 15).
  VOIZO_API_BASE: z.string().default("https://voizo-eight.vercel.app"),
  VOIZO_API_KEY: z.string().default(""),
  VOIZO_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  VOIZO_RETRY_HOURS: z.coerce.number().min(1).default(24),
  CALL_TICK_BUDGET_MINUTES: z.coerce.number().min(1).max(25).default(12),
  // Brand Brain (Clients section): how much of a client's website we read when building the profile.
  //   BRAND_BRAIN_MAX_PAGES   — pages crawled per source.
  //   BRAND_BRAIN_TEXT_BUDGET — characters of page text sent to Gemini per build.
  //   BRAND_BRAIN_CRAWLER_TOKEN — secret sent as the `x-rateup-crawler` header to the client's own site so a
  //                              Cloudflare WAF rule can let our crawler through. Empty = header not sent.
  BRAND_BRAIN_MAX_PAGES: z.coerce.number().int().min(1).default(25),
  BRAND_BRAIN_TEXT_BUDGET: z.coerce.number().int().min(1000).default(60000),
  BRAND_BRAIN_CRAWLER_TOKEN: z.string().default(""),

  // Creative Studio (month plans of branded posts). OpenAI Images makes the AI backgrounds.
  //   OPENAI_API_KEY             — empty = AI backgrounds unavailable.
  //   OPENAI_IMAGE_MODEL/QUALITY — image model + quality (low|medium|high).
  //   OPENAI_IMAGE_USD_PER_IMAGE — price used for estimates and job cost.
  //   CREATIVE_MAX_PER_PLAN      — hard cap of creatives per month plan.
  //   CREATIVE_PLAN_BUDGET_USD   — hard cap of AI spend per plan.
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2"),
  OPENAI_IMAGE_QUALITY: z.enum(["low", "medium", "high"]).default("medium"),
  OPENAI_IMAGE_USD_PER_IMAGE: z.coerce.number().min(0).default(0.053),
  CREATIVE_MAX_PER_PLAN: z.coerce.number().int().min(1).default(20),
  CREATIVE_PLAN_BUDGET_USD: z.coerce.number().min(0).default(5),

  // Mobivate (SMS — the "text a one-time link" step of the connected journey).
  // RESTful, Bearer auth. Empty MOBIVATE_API_KEY = soft no-op: the journey still runs end-to-end
  // (link + form + inbox are real), the send just logs a fake id instead of texting. So we can prove
  // the whole flow at $0 before any real SMS spend.
  //   MOBIVATE_API_BASE       — account-specific API host Mobivate provides on request (e.g. https://<your-host>).
  //   MOBIVATE_SENDER_ID      — the alphanumeric/short-code the text comes from.
  //   MOBIVATE_WEBHOOK_SECRET — verifies inbound delivery-receipt / reply webhooks (skip when empty).
  MOBIVATE_API_BASE: z.string().default(""),
  MOBIVATE_API_KEY: z.string().default(""),
  MOBIVATE_SENDER_ID: z.string().default(""),
  MOBIVATE_WEBHOOK_SECRET: z.string().default(""),

  // Ongage (outbound email for mailboxes switched to "Send via Ongage"; replies still land in the mailbox).
  //   ONGAGE_API_KEY                    — secret API key, sent as `x-api-key` (only works on api.ongage.com).
  //   ONGAGE_TRANSACTIONAL_CAMPAIGN_ID  — the Ongage transactional campaign our sends are filed under. Required:
  //                                       empty = Ongage sends are held, never filed under the account default.
  //   ONGAGE_LIST_ID                    — list that campaign belongs to. Empty = the account's default list.
  //   ONGAGE_SENDING_CONNECTION_ID      — ESP connection to send through. Empty = the campaign's default.
  ONGAGE_API_BASE: z.string().default("https://api.ongage.com"),
  ONGAGE_API_KEY: z.string().default(""),
  ONGAGE_TRANSACTIONAL_CAMPAIGN_ID: z.string().default(""),
  ONGAGE_LIST_ID: z.string().default(""),
  ONGAGE_SENDING_CONNECTION_ID: z.string().default(""),

  // Public base URL the one-time SMS link points back to (e.g. https://app.example.com).
  // Used to build ${PUBLIC_BASE_URL}/form/<token>. Falls back to localhost for local testing.
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),

  // How long a one-time form link stays valid before it expires.
  FORM_LINK_TTL_HOURS: z.coerce.number().default(72),

  // Stripe (later)
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),

  // Email verification ladder. ZeroBounce is the production workhorse (Vercel +
  // Cloud Run block port 25, so the free SMTP probe no-ops in prod). Each paid
  // key is env-gated: unset → that stage is skipped. The send-gate only turns on
  // when ZEROBOUNCE_API_KEY is set.
  ZEROBOUNCE_API_KEY: z.string().default(""),
  MILLIONVERIFIER_API_KEY: z.string().default(""),
  HUNTER_API_KEY: z.string().default(""),
  HUNTER_MAX_CALLS_PER_HOUR: z.coerce.number().default(20),
  SMTP_PROBE_HELO: z.string().default("rateupdigital.com"),
  SMTP_PROBE_FROM: z.string().default("verify@rateupdigital.com"),
});

export const env = Schema.parse(process.env);
export type Env = z.infer<typeof Schema>;
