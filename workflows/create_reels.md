# Workflow: Make a Reel from a month's posts

**Where:** client page → **Posts** tab → the **Reels** strip under the month header.

A Reel is one vertical video (1080×1920, 30 fps, H.264 MP4) that strings the month's approved posts together:
an optional opening card (logo + title on the brand colours), then each post's 9:16 frame with a slow zoom,
crossfades between them, and a thin progress bar. No audio in this version. **Free**: no AI call, no paid API —
Remotion renders it with the Cloud Run job's Chromium.

## Steps

1. Approve at least 2 posts for the month (each approved post already has a 9:16 render).
2. Click **Make a Reel**. Untick any posts to leave out (2–12), set an opening title if you want one
   (defaults to the client's name), seconds per post (default 3.5).
3. **Render Reel** → the strip shows *queued* → *rendering* → *ready* (about 1–2 minutes). The page polls by itself.
4. Play it in the strip, **Download** the MP4 (`YYYY-MM_reel_N-posts.mp4`), post it as a Reel / Short / TikTok.
5. Delete a Reel you don't want — that removes the MP4 too.

## Rules

- Only approved posts: the grounding check already passed on every claim in them.
- Order is by post date. Re-render to change the selection; each render is a new row.
- A render that dies (job timeout) is treated as failed after 40 minutes and can be re-queued.
- Remotion licence: free for companies of up to 3 people; larger teams need a Company Licence (remotion.pro).

## Data and code

- Migration `055_creative_videos.sql`: `creative_videos` (status queued / rendering / ready / failed, storage_path, public_url).
- MP4s live in the `client-assets` bucket at `<client>/reels/<id>.mp4`.
- API: `GET/POST /api/clients/:id/reels?month=`, `GET/DELETE /api/clients/:id/reels/:rid`.
- Logic: `lib/creatives/video/reel-plan.ts` (pure: slides, timing), `render-reel.ts` (bundle + render + upload),
  `remotion/` (the composition). Job: `MODE=reel REEL_ID=<id>`.
- Cloud Run image: the Dockerfile installs `@remotion/compositor-linux-x64-gnu` (Remotion's bundled ffmpeg).

## Later

- Music track (upload an MP3 as a client asset, mix it in).
- AI b-roll clips (Google Veo 3.1 through the Gemini key, ~$0.40–0.80 per 8-second clip) as slide backgrounds.
- Per-slide caption overlay from the platform captions.
