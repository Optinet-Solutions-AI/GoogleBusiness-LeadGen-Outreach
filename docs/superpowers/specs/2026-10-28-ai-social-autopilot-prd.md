# AI Social Media Autopilot — Complete Product & Technical Brief

> **Source:** product brief pasted by the operator on 2026-10-28 (PRD v1.0, October 2026), saved verbatim below.
> **Not included:** the brief references a 7-file "AI Social Autopilot — Developer Pack" ZIP (full PRD, 21 UI screens,
> social API connection guides, engineering backlog + acceptance tests, PostgreSQL schema, Claude Code instructions).
> Those files were not provided, so this document is the only copy we have.
> **Implementation plan:** [`../plans/2026-10-28-ai-social-autopilot-plan.html`](../plans/2026-10-28-ai-social-autopilot-plan.html)

Product Requirements Document (PRD) | Version 1.0 | October 2026

The product you're describing is more than a social media scheduler. It's an AI-powered marketing department in a single SaaS platform, where a business can enter its website URL, connect its social media accounts, and start generating professional, branded content with minimal manual involvement.

The core idea:

> Website URL → AI learns the business → Creates ads, images and videos → User approves → Automatically publishes → Measures results → Improves future content.

## 1. Product vision

I would design this as a multi-tenant SaaS platform where every business gets its own private AI brand workspace.

1. **Business website + products** — Automatic crawling, brand identity and knowledge extraction
2. **AI Brand Brain** — Business facts, logos, colors, products, audience and marketing style
3. **Creative Studio** — Videos, Reels, Shorts, images, carousels and ads
4. **Reference Studio** — Upload or link examples; generate brand-specific variations
5. **Review, edit and approve** — Platform previews, brand checks and human approval
6. **Publishing Engine** — Instagram · Facebook · TikTok · YouTube · LinkedIn · More
7. Recurring schedules, cross-posting, failure recovery and analytics

The most important product decision is that customers should connect social accounts using official OAuth authorization, not hand over their social media passwords. API credentials for your SaaS should normally be configured centrally by your developers. Customers should only supply their own API keys for optional third-party AI services if they choose.

This distinction matters because the platforms have different publishing requirements. Meta supports publishing through its Instagram and Facebook APIs; TikTok's direct publishing requires approved access and an audit for public posting; YouTube supports uploads through its Data API; LinkedIn provides a Posts API.

## 2. Developer specification (not included)

The brief references a development package with seven documents, including the detailed PRD, technical architecture, database design, screen specifications, API setup guidance, and implementation backlog:

- Full Product Specification (PRD)
- 21 UI Screens & Workflows
- Social API Connection Guides
- Engineering Backlog & Acceptance Tests
- PostgreSQL Database Schema
- Claude Code Development Instructions

## 3. Developer handoff — copy-paste brief

### AI Social Media Autopilot — SaaS Product Development Brief

#### Project objective

Build a production-ready, multi-tenant AI-powered social media management platform.

Any business must be able to register, enter its website URL, connect its social media accounts, automatically extract its brand identity and products, generate professional marketing creatives, approve them, and schedule or publish content on supported social networks.

The goal is to eliminate the need for businesses to explain their company repeatedly or use several disconnected software products.

#### Module 1 — Business onboarding and Brand Brain

The business registers and provides its website URL. The platform crawls accessible, authorized website content, including About Us, products, services, FAQs, pricing, brand identity, logos, images, colors, typography, contact information, marketing messages, and relevant product benefits.

An AI agent transforms the website into a structured, editable Brand Brain.

The Brand Brain must maintain a reusable business profile, brand colors in HEX, logo variants, brand voice, target audiences, verified marketing claims, approved CTAs, products, source evidence, and a version history.

The system initially recommends up to ten featured products. Users can manually add more products or upload additional assets, including images, videos and product descriptions.

All AI-generated content must reference this saved brand profile automatically. Users must be able to correct any extracted information.

#### Module 2 — Social account connections

Support Facebook Pages, Instagram professional accounts, TikTok, YouTube and, subsequently, LinkedIn and other platforms.

Use official OAuth authorization flows. Businesses must not provide social account passwords directly to our application.

Build instructions and troubleshooting for connecting each network. Store authorized tokens securely, handle token refresh, permissions, account eligibility and disconnection.

Every social account must report the creative formats and publishing actions that its current API access actually supports.

Public posting must be enabled only where the SaaS has the required platform approvals.

#### Module 3 — AI Creative Studio

Provide multiple generation modes:

- *Original creation:* User enters a brief, selects products and platforms, and AI generates original marketing images, videos, Reels, Shorts, carousels, scripts, captions and CTAs.
- *Automatic creation:* The platform generates content ideas and creative packs using the saved Brand Brain without requiring a new brief.
- *Product-to-ad:* User selects or uploads product images. The system creates product advertisements using confirmed descriptions, features and brand styling.
- *Reference-inspired creation:* User pastes a competitor's image/video URL or uploads an example. AI analyzes the visual structure, opening hook, pace, transitions, text style, creative concept and CTA. It generates an original, brand-specific variation without automatically reusing unlicensed third-party material.
- *Authorized video/image editing:* When users own or are licensed to modify the source material, provide supported options to replace logos, text, products, colors and end cards. If direct video editing is unreliable, offer reconstruction through an editable template.
- *Template creation:* Provide editable templates for promotions, product launches, seasonal campaigns, educational videos, product comparisons and more.

Support multiple creative variations and platform-specific aspect ratios.

Use a hybrid creation system: AI for imagery, creative ideas and selected video scenes; deterministic rendering for exact logos, text, prices, product images, subtitles and CTAs.

Users must be able to revise individual scenes without regenerating an entire video.

#### Module 4 — Creative editor and asset library

Provide a centralized media library containing uploaded and generated images, logos, videos, product photographs, stock media and approved reference content.

The editor must support text changes, scene order, timing, brand colors, logos, subtitles, music, narration, CTA, dimensions and multiple exported versions.

Maintain original assets, rendered outputs and version history separately.

#### Module 5 — Approval workflows

Every creative must have preview, edit, reject, request-changes and approve options.

Approval occurs for an immutable content version and its destination platform. Editing materially approved content must invalidate the relevant approval.

No content should publish without explicit approval by default.

Support workspace owners, admins, content editors, approvers and viewers, with clear roles and audit trails.

#### Module 6 — Social media calendar and automatic publishing

Users can configure rules such as:

- Monday, 10:00 — Instagram Reel and Facebook Reel.
- Tuesday, 12:00 — Product image on Instagram.
- Thursday, 18:00 — TikTok product video.
- Saturday, 11:00 — Facebook promotional post.

Support one-time posts, recurring weekly schedules, multiple social accounts, time zones, seasonal campaigns, blackout dates, content rotation and bulk scheduling.

Automatically create drafts before the scheduled date, allow approval, and publish approved posts through the appropriate official platform API.

Provide platform-specific captions, hashtags, thumbnails, videos and image versions.

Implement retries, token checks, queue processing, rate limits, duplicate prevention, provider status reconciliation and clear failure notifications.

A post is marked published only when the social platform confirms the relevant outcome.

#### Module 7 — AI Marketing Agent

Provide specialized AI functions for business research, content ideas, copywriting, storyboarding, media generation, brand checking and performance analysis.

The system must recognize previously used products and concepts and avoid excessive repetition.

It should suggest content based on business goals and historical performance data where authorized data exists.

AI-generated factual claims, prices, discounts, testimonials and product details must be verified against approved business information.

#### Module 8 — Dashboard and analytics

The dashboard must show:

- Business brand identity and connected social accounts.
- Upcoming scheduled publications.
- Content awaiting approval.
- Generated assets and ongoing generation jobs.
- Successful, failed and pending publications.
- Social account performance where API data is available.
- AI usage, generation costs and credit balance.
- Content recommendations based on supported performance metrics.

Allow filtering by campaign, platform, product, date and status.

#### Module 9 — SaaS billing and tenant isolation

Each customer must have a private workspace containing its own business data, products, social connections, assets, campaigns and billing.

Support monthly subscription plans, usage-based AI credits, account/brand limits, premium video generation costs and spending caps.

AI media costs must be measurable per generation job.

Workspace data and media must be securely isolated from other customers.

#### Module 10 — Administration

Provide a platform-wide administration dashboard for managing subscriptions, users, workspaces, social integrations, app review status, AI provider settings, generation failures, publication jobs and costs.

Support platform-level feature flags, connector maintenance and operational monitoring.

#### Suggested architecture

Use Next.js/React/TypeScript for frontend, a TypeScript API backend, PostgreSQL database, Redis/BullMQ for background workflows, private S3-compatible object storage, and Remotion/FFmpeg for deterministic media rendering.

Build AI provider adapters for text, vision, images, video and voice synthesis so that individual models or providers can be replaced without rebuilding the application.

Build separate social publishing adapters for Facebook, Instagram, TikTok, YouTube and LinkedIn.

Use asynchronous queues for website scanning, AI generation, rendering, scheduling, posting and analytics collection.

#### Key acceptance criteria

A new customer can register, add a real website, receive a reviewable and editable Brand Brain, upload additional products, generate a branded image and video, create an original reference-inspired variation, connect eligible social accounts through OAuth, approve content, schedule recurring posts and verify real publishing results.

The implementation must handle permissions, API failures, disconnected accounts, duplicate prevention, content rights, factual marketing claims, budget limits and workspace security.

*Development instruction:* Use the accompanying full PRD, UI specifications, API integration guides, database schema and engineering backlog as the authoritative implementation references. Build functional modules with automated tests and real integrations where permission has been granted. Do not substitute fake successful publishing or hardcoded AI outputs for functioning features.

## 4. Important implementation choices

These are the parts I would give special attention to before development begins.

| Component           | Recommended approach                                                   | Why                                                  |
| ------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Brand intelligence  | Structured knowledge base with website source evidence                 | Prevents the system from guessing about the business |
| Product images      | Preserve real product assets, use AI for scenes and backgrounds        | Prevents inaccurate product packaging or appearance  |
| AI video            | Provider-agnostic generation plus Remotion/FFmpeg                      | Better control of branding, quality and costs        |
| Competitor examples | Creative analysis and original variations; licensed editing separately | More useful and safer than unauthorized copying      |
| Social connections  | Official OAuth with securely stored tokens                             | Scalable across customer accounts                    |
| Scheduling          | Server-managed queue plus platform adapters                            | Enables recurring campaigns and failure recovery     |
| Approvals           | Immutable approved content versions                                    | Prevents accidental publication of later edits       |
| Monetization        | Subscriptions plus measured AI credits                                 | Controls expensive video-generation usage            |

One particularly important point: TikTok's official rules require specific posting UX and an audit for unrestricted public direct posting. That needs to be planned into the product, not treated as a simple API call.

Similarly, YouTube has a published upload API, while Shorts classification is based on eligible uploaded video characteristics; qualifying square or vertical videos can be up to three minutes long.

## 5. How I would start development

With a team of five developers, I would first build and validate the following complete user journey:

1. **Stage 1 — Brand Brain:** Signup, URL scanner, editable business knowledge, 10 featured products and image library.
2. **Stage 2 — Creative generation:** Static ads, template-based product videos, AI image generation, reference analysis and editable variations.
3. **Stage 3 — Approval and scheduling:** Calendar, recurring schedules, brand-specific captions, approvals, notifications and queue processing.
4. **Stage 4 — Live social publishing:** Prioritize Meta integrations, then TikTok, YouTube and LinkedIn as the necessary approvals become available.
5. **Stage 5 — Advanced autopilot:** Performance analytics, automatic content recommendations, agency accounts, advanced AI videos and optional trusted publishing workflows.

My main product recommendation: Make the Brand Brain the foundation, not just a website summary. A system that understands a business, remembers its products, generates high-quality branded material, and reliably manages its content calendar has a much stronger value proposition than another generic AI video generator.

The ZIP contains the detailed requirements needed to begin implementing that product, including screen behavior, data structures, social API setup instructions, backend contracts, security requirements, and development acceptance tests.
