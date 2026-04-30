#!/usr/bin/env bash
# scripts/setup-wif.sh — Workload Identity Federation between Vercel and GCP.
#
# Why: org policy iam.disableServiceAccountKeyCreation forbids long-lived
# JSON keys. WIF replaces them — Vercel mints a short-lived OIDC token at
# runtime, GCP exchanges it for a 1-hour access token, no key ever exists
# on disk.
#
# Prereqs:
#   - deploy-cloud-run-job.sh has been run successfully (the SA exists)
#   - You have your Vercel team slug (from your team URL: vercel.com/<TEAM>)
#   - You have your Vercel project name (URL slug, e.g. scraping-business-google-map)
#   - You've enabled OIDC Federation in Vercel:
#       Project → Settings → Security → OIDC Federation → Enable
#
# Run from the repo root:
#   bash scripts/setup-wif.sh

set -euo pipefail

POOL_NAME="vercel-pool"
PROVIDER_NAME="vercel-provider"
RUNTIME_SA_NAME="vercel-trigger-sa"

# --- resolve project / region ----------------------------------------------
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-us-central1}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: PROJECT_ID not set. Run: gcloud config set project <id>"
  exit 1
fi

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA_EMAIL="$RUNTIME_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

# --- verify SA exists from previous deploy ---------------------------------
if ! gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  echo "ERROR: $SA_EMAIL not found. Run scripts/deploy-cloud-run-job.sh first."
  exit 1
fi

# --- gather Vercel info (env vars OR prompt) -------------------------------
# You can set VERCEL_TEAM and VERCEL_PROJECT before running to skip prompts:
#   VERCEL_TEAM=foo VERCEL_PROJECT=bar bash scripts/setup-wif.sh
VERCEL_TEAM="${VERCEL_TEAM:-}"
VERCEL_PROJECT="${VERCEL_PROJECT:-}"

if [[ -z "$VERCEL_TEAM" ]]; then
  read -r -p "  Vercel team slug (e.g. optinet-solutions-aisandbox): " VERCEL_TEAM
fi
if [[ -z "$VERCEL_PROJECT" ]]; then
  read -r -p "  Vercel project name slug (e.g. scraping-business-google-map): " VERCEL_PROJECT
fi

if [[ -z "$VERCEL_TEAM" || -z "$VERCEL_PROJECT" ]]; then
  echo "ERROR: both team slug and project name are required"
  exit 1
fi

echo
echo "==> Config summary"
echo "    PROJECT_ID      = $PROJECT_ID  (number: $PROJECT_NUMBER)"
echo "    REGION          = $REGION"
echo "    SA              = $SA_EMAIL"
echo "    Vercel team     = $VERCEL_TEAM"
echo "    Vercel project  = $VERCEL_PROJECT"
echo "    Issuer URI      = https://oidc.vercel.com/$VERCEL_TEAM"
echo

# --- 1. workload identity pool --------------------------------------------
echo "==> [1/3] Ensuring Workload Identity Pool $POOL_NAME exists..."
if ! gcloud iam workload-identity-pools describe "$POOL_NAME" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_NAME" \
    --location=global \
    --display-name="Vercel OIDC Pool" \
    --description="Trusts Vercel-issued OIDC tokens for serverless functions" \
    --quiet
else
  echo "    (already exists, skipping)"
fi

# --- 2. OIDC provider in the pool -----------------------------------------
echo "==> [2/3] Ensuring OIDC provider $PROVIDER_NAME exists..."
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
        --workload-identity-pool="$POOL_NAME" --location=global >/dev/null 2>&1; then
  # Attribute mapping: pull the Vercel claims we want into GCP attributes,
  # so the IAM binding below can reference them.
  # Attribute condition: ONLY accept tokens for THIS specific Vercel project,
  # so a different project on the same Vercel team can't impersonate the SA.
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
    --workload-identity-pool="$POOL_NAME" \
    --location=global \
    --issuer-uri="https://oidc.vercel.com/$VERCEL_TEAM" \
    --allowed-audiences="https://vercel.com/$VERCEL_TEAM" \
    --attribute-mapping="google.subject=assertion.sub,attribute.project=assertion.project,attribute.environment=assertion.environment,attribute.owner=assertion.owner" \
    --attribute-condition="assertion.project=='$VERCEL_PROJECT'" \
    --quiet
else
  echo "    (already exists — to update issuer/condition, delete it first:"
  echo "     gcloud iam workload-identity-pools providers delete $PROVIDER_NAME \\"
  echo "       --workload-identity-pool=$POOL_NAME --location=global)"
fi

# --- 3. allow tokens-from-this-pool to impersonate vercel-trigger-sa ------
echo "==> [3/3] Granting workloadIdentityUser on $SA_EMAIL..."
PRINCIPAL="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_NAME/attribute.project/$VERCEL_PROJECT"
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="$PRINCIPAL" \
  --role="roles/iam.workloadIdentityUser" \
  --quiet >/dev/null

# --- output: the 5 Vercel env vars -----------------------------------------
WIP_RESOURCE="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_NAME/providers/$PROVIDER_NAME"

echo
echo "============================================================"
echo "DONE. Paste these 5 env vars into Vercel → Settings → Env Vars"
echo "(Production + Preview if you want both to use Cloud Run)"
echo "============================================================"
echo "GCP_PROJECT_ID                  = $PROJECT_ID"
echo "GCP_REGION                      = $REGION"
echo "CLOUD_RUN_JOB_NAME              = lead-batch-runner"
echo "GCP_SERVICE_ACCOUNT_EMAIL       = $SA_EMAIL"
echo "GCP_WORKLOAD_IDENTITY_PROVIDER  = $WIP_RESOURCE"
echo
echo "============================================================"
echo "Make sure OIDC Federation is ENABLED in Vercel:"
echo "  Project → Settings → Security → OIDC Federation"
echo "After saving the env vars, redeploy from Vercel (latest deployment)."
echo "============================================================"
