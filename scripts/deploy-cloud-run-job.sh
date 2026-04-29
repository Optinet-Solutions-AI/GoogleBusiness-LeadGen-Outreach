#!/usr/bin/env bash
# scripts/deploy-cloud-run-job.sh — End-to-end Cloud Run Job setup.
#
# Idempotent — safe to re-run after the first time. Re-running rebuilds
# the image and updates the job. Use that as your normal "deploy after
# code changes" workflow.
#
# Reads:
#   .env at repo root  → secret values pushed to Secret Manager
#   gcloud config      → PROJECT_ID (override with env var)
#
# Run from repo root:
#   bash scripts/deploy-cloud-run-job.sh
#
# Optional overrides:
#   PROJECT_ID=... REGION=us-east1 bash scripts/deploy-cloud-run-job.sh

set -euo pipefail

# --- locate repo root + .env ------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

cd "$REPO_ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ENV_FILE"
  echo "Create it from .env.example with your real values, then re-run."
  exit 1
fi

# Source .env so its variables are available below.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# --- resolve GCP project + region -------------------------------------------
PROJECT_ID="${PROJECT_ID:-${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}}"
REGION="${REGION:-${GCP_REGION:-us-central1}}"
JOB_NAME="${CLOUD_RUN_JOB_NAME:-lead-batch-runner}"
RUNTIME_SA="lead-batch-runner-sa"
TRIGGER_SA="vercel-trigger-sa"
REPO_NAME="leadgen-jobs"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/runner:latest"

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: PROJECT_ID not set."
  echo "Run: gcloud config set project <your-project-id>"
  echo "Or:  PROJECT_ID=<your-project-id> bash scripts/deploy-cloud-run-job.sh"
  exit 1
fi

echo "==> PROJECT_ID = $PROJECT_ID"
echo "==> REGION     = $REGION"
echo "==> JOB_NAME   = $JOB_NAME"
echo "==> IMAGE      = $IMAGE"
echo

# --- verify required secrets are in .env ------------------------------------
REQUIRED_SECRETS=(
  SUPABASE_URL
  SUPABASE_SERVICE_KEY
  GOOGLE_PLACES_API_KEY
  GOOGLE_GENAI_API_KEY
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
)
missing=()
for var in "${REQUIRED_SECRETS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "ERROR: missing values in .env for: ${missing[*]}"
  echo "Fill them in and re-run."
  exit 1
fi

gcloud config set project "$PROJECT_ID" --quiet

# --- 1. enable APIs ---------------------------------------------------------
echo "==> [1/8] Enabling APIs (idempotent)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  --quiet

# --- 2. artifact registry ---------------------------------------------------
echo "==> [2/8] Ensuring Artifact Registry repo $REPO_NAME exists..."
if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Lead-gen pipeline job images" \
    --quiet
else
  echo "    (already exists, skipping)"
fi

# --- 3. service accounts ----------------------------------------------------
ensure_sa() {
  local name=$1
  local description=$2
  local email="$name@$PROJECT_ID.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$email" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$name" --display-name="$description" --quiet
  else
    echo "    (SA $name already exists, skipping)"
  fi
}

echo "==> [3/8] Ensuring service accounts exist..."
ensure_sa "$RUNTIME_SA" "Cloud Run Job runtime: lead-batch-runner"
ensure_sa "$TRIGGER_SA" "Vercel → Cloud Run Job trigger"

# --- 4. push secrets to Secret Manager + grant SA read access --------------
echo "==> [4/8] Syncing secrets to Secret Manager..."
push_secret() {
  local name=$1
  local value=$2
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf "%s" "$value" | gcloud secrets versions add "$name" --data-file=- --quiet >/dev/null
    echo "    [+] $name (new version)"
  else
    printf "%s" "$value" | gcloud secrets create "$name" --data-file=- --quiet >/dev/null
    echo "    [+] $name (created)"
  fi
}

for var in "${REQUIRED_SECRETS[@]}"; do
  push_secret "$var" "${!var}"
done

echo "==> Granting $RUNTIME_SA secretAccessor on each secret..."
for var in "${REQUIRED_SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "$var" \
    --member="serviceAccount:$RUNTIME_SA@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null
done

# --- 5. build image ---------------------------------------------------------
echo "==> [5/8] Building image with Cloud Build (this takes 3-5 min on first run)..."
gcloud builds submit --tag "$IMAGE" . --quiet

# --- 6. create or update the job -------------------------------------------
SECRET_PAIRS="SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,GOOGLE_PLACES_API_KEY=GOOGLE_PLACES_API_KEY:latest,GOOGLE_GENAI_API_KEY=GOOGLE_GENAI_API_KEY:latest,CLOUDFLARE_API_TOKEN=CLOUDFLARE_API_TOKEN:latest,CLOUDFLARE_ACCOUNT_ID=CLOUDFLARE_ACCOUNT_ID:latest"

echo "==> [6/8] Creating or updating Cloud Run Job $JOB_NAME..."
if gcloud run jobs describe "$JOB_NAME" --region="$REGION" >/dev/null 2>&1; then
  gcloud run jobs update "$JOB_NAME" \
    --image="$IMAGE" \
    --region="$REGION" \
    --service-account="$RUNTIME_SA@$PROJECT_ID.iam.gserviceaccount.com" \
    --task-timeout=1800s \
    --max-retries=0 \
    --memory=1Gi \
    --cpu=1 \
    --set-secrets="$SECRET_PAIRS" \
    --set-env-vars="APP_ENV=production,LOG_LEVEL=info" \
    --quiet
else
  gcloud run jobs create "$JOB_NAME" \
    --image="$IMAGE" \
    --region="$REGION" \
    --service-account="$RUNTIME_SA@$PROJECT_ID.iam.gserviceaccount.com" \
    --task-timeout=1800s \
    --max-retries=0 \
    --memory=1Gi \
    --cpu=1 \
    --set-secrets="$SECRET_PAIRS" \
    --set-env-vars="APP_ENV=production,LOG_LEVEL=info" \
    --quiet
fi

# --- 7. allow Vercel SA to invoke the job ----------------------------------
echo "==> [7/8] Granting $TRIGGER_SA run.invoker on $JOB_NAME..."
gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
  --region="$REGION" \
  --member="serviceAccount:$TRIGGER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --quiet >/dev/null

# --- 8. (re)mint Vercel SA key + print base64 -------------------------------
KEY_FILE="$REPO_ROOT/vercel-trigger-sa.json"
echo "==> [8/8] Generating fresh SA key for Vercel..."
gcloud iam service-accounts keys create "$KEY_FILE" \
  --iam-account="$TRIGGER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --quiet

KEY_B64=$(base64 -w0 "$KEY_FILE" 2>/dev/null || base64 -i "$KEY_FILE" | tr -d '\n')

echo
echo "============================================================"
echo "DONE. Paste these 4 env vars into Vercel → Settings → Env Vars"
echo "============================================================"
echo "GCP_PROJECT_ID       = $PROJECT_ID"
echo "GCP_REGION           = $REGION"
echo "CLOUD_RUN_JOB_NAME   = $JOB_NAME"
echo "GCP_SA_KEY_BASE64    = (long string below — copy the whole line)"
echo
echo "$KEY_B64"
echo
echo "============================================================"
echo "After saving in Vercel, click Redeploy on the latest deployment."
echo
echo "Then DELETE the SA key from your laptop:"
echo "   rm \"$KEY_FILE\""
echo "============================================================"
