# Dockerfile — image for the Cloud Run Job `lead-batch-runner`.
#
# Runs scripts/cloud-run-job.ts via tsx so we don't need a separate TS build
# step — the orchestrator + pipeline + services all import via the @/ path
# alias defined in web/tsconfig.json, which tsx resolves at runtime.
#
# Build:
#   gcloud builds submit --tag <region>-docker.pkg.dev/<project>/leadgen-jobs/runner:latest .
# Run locally for testing:
#   docker build -t lead-batch-runner . && \
#     docker run --rm --env-file .env -e BATCH_ID=<uuid> lead-batch-runner

FROM node:20-alpine

WORKDIR /app/web

# Install deps first for layer caching
COPY web/package.json web/package-lock.json* ./
RUN npm ci --omit=optional

# App code (only what the job needs — Next.js pages/components are skipped
# by .dockerignore so the image stays small and the build stays fast).
COPY web/ ./

# Cloud Run Jobs don't bind to a port, but Node still needs UTF-8 + a valid HOME.
ENV NODE_ENV=production \
    HOME=/tmp

# tsx resolves @/* aliases via web/tsconfig.json at runtime.
CMD ["npx", "tsx", "--tsconfig", "tsconfig.json", "scripts/cloud-run-job.ts"]
