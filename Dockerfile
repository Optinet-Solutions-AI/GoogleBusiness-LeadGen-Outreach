# Dockerfile — image for the Cloud Run Job `lead-batch-runner`.
#
# Runs scripts/cloud-run-job.ts via tsx so we don't need a separate TS build
# step — the orchestrator + pipeline + services all import via the @/ path
# alias defined in web/tsconfig.json, which tsx resolves at runtime.
#
# The image bundles the Astro site templates and pre-installs their deps,
# so when stage-3-generate spawns `npm run build` inside templates/<slug>/
# it runs in ~5s instead of doing a fresh `npm install` (~60s) per lead.
#
# Build:
#   gcloud builds submit --tag <region>-docker.pkg.dev/<project>/leadgen-jobs/runner:latest .
# Run locally:
#   docker build -t lead-batch-runner . && \
#     docker run --rm --env-file .env -e MODE=batch -e BATCH_ID=<uuid> lead-batch-runner

# Base: Debian-slim (not Alpine). Playwright's Chromium binary is built
# against glibc, not musl — the Alpine variant has no working binary, and
# bundling a musl-built Chromium is more pain than the image-size win.
# Debian also gives us `apt`, which `playwright install --with-deps` uses
# to drop Chromium's runtime libraries.
FROM node:22-bookworm-slim

# Tools we install at the OS level:
#   - ca-certificates: HTTPS to Brandfetch + Gemini + Cloudflare APIs
#   - bash: convenient for any shell-piping inside child processes
#   - wrangler: Cloudflare's CLI — used by stage-4-deploy to push the
#     built site. The REST direct-upload API requires a manifest+hash+
#     check-missing dance that wrangler abstracts.
# Playwright's Chromium runtime deps (libnss3, libatk1.0-0, etc.) are
# installed later by `playwright install --with-deps chromium`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates bash \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g wrangler@latest

# Layout (matches stage-3-generate's path resolution: REPO_ROOT = ../web's parent):
#   /app/web/         <- Cloud Run Job code (entrypoint here)
#   /app/templates/   <- Astro templates with deps pre-installed

# --- web layer (orchestrator + services) ----------------------------------
WORKDIR /app/web

# Install web deps first so Docker can cache them across rebuilds when only
# app code changes. Skip the auto-download of Chromium during `npm ci` and
# instead drive it explicitly below — saves us downloading firefox+webkit
# (~400MB) we don't use.
#
# PLAYWRIGHT_BROWSERS_PATH pins the install location to /opt/... so it
# survives the runtime HOME=/tmp override at the bottom of this file.
# Without this, Playwright installs under $HOME/.cache/ms-playwright at
# build time (= /root/.cache/...) and at runtime looks under
# /tmp/.cache/... because HOME changed, then crashes with
# "Executable doesn't exist".
COPY web/package.json web/package-lock.json* ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN npm ci --omit=optional

# Install Chromium + its Linux runtime deps (libnss, libatk, libxkbcommon,
# etc.) via Playwright's official installer. --with-deps shells out to apt.
# This adds ~250MB to the image but is the supported path for headless
# Chromium on Debian.
RUN npx playwright install --with-deps chromium

# App code (only what the job needs — Next.js pages/components are skipped
# by .dockerignore).
COPY web/ ./

# --- templates layer (Astro site projects) --------------------------------
# Copy the template package files first and pre-install. New templates added
# under templates/<slug>/ get picked up by the COPY templates/ step below;
# add a corresponding `RUN cd /app/templates/<slug> && npm ci` line per
# template if you want their deps pre-baked too.
COPY templates/trades/package.json templates/trades/package-lock.json* /app/templates/trades/
COPY templates/premium-trades/package.json templates/premium-trades/package-lock.json* /app/templates/premium-trades/
# Pre-install for both templates so stage-3-generate doesn't need to run
# `npm install` on the first build per template (saves ~60s/lead).
# Rollup ships platform-specific binaries via optionalDependencies — on
# Debian/glibc the linux-x64-gnu binary is what npm picks. Don't pass
# --omit=optional here or Astro's build will die with "Cannot find module".
RUN cd /app/templates/trades && npm ci
RUN cd /app/templates/premium-trades && npm ci

# Now the rest of the templates dir (source files, configs, README).
COPY templates/ /app/templates/

# Cloud Run Jobs don't bind to a port, but Node still needs UTF-8 + a valid
# HOME. /app/.tmp is where stage-3-generate writes generated-sites/ — make
# sure it's writable (Cloud Run's filesystem is by default).
ENV NODE_ENV=production \
    HOME=/tmp

CMD ["npx", "tsx", "--tsconfig", "tsconfig.json", "scripts/cloud-run-job.ts"]
