/**
 * config.ts — Loads + validates env vars into a typed `env` object.
 *
 * Inputs:  process.env (loaded from .env at repo root by Next + tsx)
 * Outputs: `env` singleton imported everywhere
 * Used by: every module that touches an external service or the DB
 */

import { z } from "zod";

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

  // Google Gemini (site copy generation — uses the free tier on your GCP project)
  // Get a key at: https://aistudio.google.com/app/apikey  (separate from the Places key)
  GOOGLE_GENAI_API_KEY: z.string().default(""),
  GOOGLE_GENAI_MODEL: z.string().default("gemini-2.5-flash"),

  // Cloudflare Pages
  CLOUDFLARE_API_TOKEN: z.string().default(""),
  CLOUDFLARE_ACCOUNT_ID: z.string().default(""),
  CLOUDFLARE_PAGES_ROOT_DOMAIN: z.string().default(""),

  // Instantly
  INSTANTLY_API_KEY: z.string().default(""),
  INSTANTLY_FROM_EMAIL: z.string().default(""),

  // Stripe (later)
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
});

export const env = Schema.parse(process.env);
export type Env = z.infer<typeof Schema>;
