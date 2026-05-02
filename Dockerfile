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

FROM node:22-alpine

# Astro builds shell out to a few tools (sharp / image plugins occasionally,
# postcss). bash is also handy for any shell-piping inside child processes.
# Wrangler is Cloudflare's official CLI — used by stage-4-deploy to push
# the built site to Cloudflare Pages. The REST direct-upload API now
# requires a manifest + hash + check-missing dance that wrangler abstracts.
RUN apk add --no-cache bash libc6-compat \
 && npm install -g wrangler@latest

# Layout (matches stage-3-generate's path resolution: REPO_ROOT = ../web's parent):
#   /app/web/         <- Cloud Run Job code (entrypoint here)
#   /app/templates/   <- Astro templates with deps pre-installed

# --- web layer (orchestrator + services) ----------------------------------
WORKDIR /app/web

# Install web deps first so Docker can cache them across rebuilds when only
# app code changes.
COPY web/package.json web/package-lock.json* ./
RUN npm ci --omit=optional

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
# DON'T omit optionals here — Rollup (used by Astro) ships its musl
# binary as @rollup/rollup-linux-x64-musl in optionalDependencies, and
# without it Astro's build dies with "Cannot find module" on Alpine.
# Pre-install for both templates so stage-3-generate doesn't need to run
# `npm install` on the first build per template (saves ~60s/lead).
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
