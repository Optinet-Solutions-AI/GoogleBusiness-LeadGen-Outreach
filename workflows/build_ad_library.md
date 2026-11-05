# Workflow: Build the competitor Ad Library and make our version of an ad

**Page:** `/ads` (sidebar → Clients → Ad Library).

Meny's ask: browse the image and video ads competitors are running, keep the good ones, and make our own
version for a client. We never reuse a competitor's footage, images or text — that is their copyright. We copy the
**idea**: the hook, the structure, the pacing, the offer shape, the call to action. Creative Studio then builds an
original post (and a Reel) for our client from the client's own Brand Brain facts, photos and logo.

## 1. Pull ads (paid, cents)

1. Click **Pull ads**. Either paste a **Meta Ad Library URL** (a brand's page in the library, or a search) or type a
   **keyword** (e.g. `flooring store`) + country. Pick *video*, *image* or *all*, *active only*, and how many (default 50, max 200).
2. The cost is shown before you confirm: about **$0.006 per ad** (Apify `apify/facebook-ads-scraper`), so 50 ads ≈ 30¢.
3. The pull runs on the Cloud Run job (`MODE=ad-pull PULL_ID=<id>`), 1–3 minutes. The page polls by itself.
4. Ads land in the library with: page name, ad text, headline, CTA, link, platforms, start date, still-running flag,
   the video (HD URL) or images, and a thumbnail we copy into our Storage so the card keeps working after Meta's
   CDN links expire.

Source: the **Meta Ad Library** (Facebook + Instagram + Threads + Audience Network). Google's Ads Transparency
Center and TikTok's Creative Center are not wired yet.

## 2. Browse and keep

- Filter by video / image, saved only, page name or text. Click a card for the full ad with the video player.
- **Save** (star) keeps the ad: its video and images are copied into our Storage so they never expire.
- Tags and a note on each ad are free text.

## 3. Make our version (Gemini, fractions of a cent)

1. On a saved ad click **Make our version**, pick the client and platforms.
2. Gemini reads the ad (text + what we know about the media) and the client's Brand Brain, and returns an analysis:
   the hook, the angle, why it works, the structure, a **brief** for our own post, a **video script** (scenes with
   on-screen text, visual, seconds) and a template suggestion.
3. We create a Creative Studio post from that brief (free until you Generate it). The analysis and script are kept on
   the ad. "Open in Creative Studio" takes you to the post: Generate → review → approve as usual; approved posts can
   go into a Reel (`workflows/create_reels.md`), and the script tells the editor what each scene should show.

## Rules

- Never download a competitor's media into a client's assets, never put their text in a post. The brief is ours.
- Every claim in our version still goes through grounding against the Brand Brain — nothing from the competitor
  ad can become a claim about our client.
- Pulls are paid: confirm the estimate. Keep pulls small and targeted (one competitor, one keyword).

## Data and code

- Migration `056_ad_library.sql`: `ad_pulls` (requests, status, cost) and `competitor_ads` (one row per ad, unique by
  Meta ad id; `saved`, `tags`, `notes`, `analysis`, `remakes`, `stored_*` copies).
- `lib/services/apify-ads.ts` (pull + normalise), `lib/services/gemini-ads.ts` (analysis), `lib/ads/*` (pulls, library, remake).
- API: `GET /api/ads`, `GET/POST /api/ads/pulls`, `PATCH/DELETE /api/ads/:id`, `POST /api/ads/:id/remake`.
- Env: `APIFY_ADS_USD_PER_AD` (0.0058), `ADS_MAX_PER_PULL` (200).
