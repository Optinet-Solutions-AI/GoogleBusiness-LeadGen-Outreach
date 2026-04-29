# Cloud Run Jobs runbook

End-to-end setup for `lead-batch-runner` — the Cloud Run Job that runs the
scraping pipeline so the dashboard isn't capped at Vercel's 60s function
limit.

Architecture:

```
Browser → Vercel /api/batches/:id/run (thin trigger)
            └→ Cloud Run Jobs API → spawns lead-batch-runner execution
                                       └→ runBatch(BATCH_ID) → Supabase
                                                                   ↑
Browser ← Vercel /api/batches/:id (poll every 3s) ─────────────────┘
```

Run every command from the **repo root** unless noted. Replace `$PROJECT_ID`
with your actual GCP project (the same one that holds Places + Gemini keys).

---

## 0. Prereqs

- `gcloud` CLI installed and `gcloud auth login` done
- Billing enabled on `$PROJECT_ID`
- You know which region to use (recommend `us-central1` — same region Places API uses)

```bash
export PROJECT_ID=<your-gcp-project>
export REGION=us-central1
gcloud config set project $PROJECT_ID
```

---

## 1. Enable APIs (one-time)

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com
```

---

## 2. Artifact Registry (one-time)

The image lives in Artifact Registry, not Container Registry (the latter is
deprecated).

```bash
gcloud artifacts repositories create leadgen-jobs \
  --repository-format=docker \
  --location=$REGION \
  --description="Lead-gen pipeline job images"
```

---

## 3. Service accounts (one-time)

Two SAs — one for the job (reads secrets, calls APIs) and one for Vercel
(only invokes the job).

```bash
# (a) Runtime SA — what the Cloud Run Job runs as.
gcloud iam service-accounts create lead-batch-runner-sa \
  --display-name="Cloud Run Job runtime: lead-batch-runner"

# Grants the runtime SA permission to read secrets it'll be wired to.
# (We grant on individual secrets in step 4, not project-wide.)

# (b) Trigger SA — what Vercel uses to start job executions.
gcloud iam service-accounts create vercel-trigger-sa \
  --display-name="Vercel → Cloud Run Job trigger"
```

---

## 4. Secrets (one-time + whenever values rotate)

Store every secret the pipeline needs in Secret Manager. The runtime SA
reads them at job-start time.

```bash
# Helper — create a secret from a file or stdin
create_secret() {
  local name=$1
  local value=$2
  printf "%s" "$value" | gcloud secrets create "$name" --data-file=-
}

# Replace the right-hand side with your real values, OR use --data-file=-
# and paste interactively (more secure — values won't end up in shell history).
create_secret SUPABASE_URL              "https://<project>.supabase.co"
create_secret SUPABASE_SERVICE_KEY      "<service-role-jwt>"
create_secret GOOGLE_PLACES_API_KEY     "<places-key>"
create_secret GOOGLE_GENAI_API_KEY      "<gemini-key>"
create_secret CLOUDFLARE_API_TOKEN      "<cf-token>"
create_secret CLOUDFLARE_ACCOUNT_ID     "<cf-account-id>"
# Add INSTANTLY_API_KEY when you wire stage 5.

# Grant the runtime SA read access to each secret
for SECRET in SUPABASE_URL SUPABASE_SERVICE_KEY GOOGLE_PLACES_API_KEY \
              GOOGLE_GENAI_API_KEY CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:lead-batch-runner-sa@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 5. Build the image

`Dockerfile` and `.dockerignore` live at the repo root and are already set
up. The build context is the repo root.

```bash
gcloud builds submit \
  --tag $REGION-docker.pkg.dev/$PROJECT_ID/leadgen-jobs/runner:latest \
  .
```

> First build is slow (~3-5 min). Subsequent builds are faster thanks to
> Docker layer caching.

---

## 6. Create the job (one-time)

```bash
gcloud run jobs create lead-batch-runner \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/leadgen-jobs/runner:latest \
  --region=$REGION \
  --service-account=lead-batch-runner-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --task-timeout=1800s \
  --max-retries=0 \
  --memory=1Gi \
  --cpu=1 \
  --set-secrets="SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,GOOGLE_PLACES_API_KEY=GOOGLE_PLACES_API_KEY:latest,GOOGLE_GENAI_API_KEY=GOOGLE_GENAI_API_KEY:latest,CLOUDFLARE_API_TOKEN=CLOUDFLARE_API_TOKEN:latest,CLOUDFLARE_ACCOUNT_ID=CLOUDFLARE_ACCOUNT_ID:latest" \
  --set-env-vars="APP_ENV=production,LOG_LEVEL=info"
```

Flags explained:
- `--task-timeout=1800s` — 30 min cap per execution. Plenty for 60-lead scrapes.
- `--max-retries=0` — don't retry failed jobs (would re-burn paid API quota).
- `--memory=1Gi --cpu=1` — comfortable for the orchestrator + Node + tsx.

---

## 7. Allow Vercel to invoke the job

```bash
gcloud run jobs add-iam-policy-binding lead-batch-runner \
  --region=$REGION \
  --member="serviceAccount:vercel-trigger-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

---

## 8. Generate Vercel's SA key

```bash
gcloud iam service-accounts keys create vercel-trigger-sa.json \
  --iam-account=vercel-trigger-sa@$PROJECT_ID.iam.gserviceaccount.com

# Encode for Vercel env var
base64 -w0 vercel-trigger-sa.json > vercel-trigger-sa.b64
cat vercel-trigger-sa.b64
```

> **Treat `vercel-trigger-sa.json` like a password.** It's gitignored by
> default, but delete it from your laptop after pasting into Vercel:
> `rm vercel-trigger-sa.json vercel-trigger-sa.b64`

---

## 9. Wire Vercel env vars

In **Vercel project → Settings → Environment Variables** (Production +
Preview), add:

| Name | Value |
|------|-------|
| `GCP_PROJECT_ID` | your project id |
| `GCP_REGION` | `us-central1` |
| `CLOUD_RUN_JOB_NAME` | `lead-batch-runner` |
| `GCP_SA_KEY_BASE64` | contents of `vercel-trigger-sa.b64` (one long line) |

Trigger a redeploy from Vercel after adding them (Vercel doesn't pick up
env-var changes on running deployments).

---

## 10. Smoke test

```bash
# Pick an existing batch_id from Supabase (or create one via the dashboard
# but DON'T click Re-run yet — you're going to trigger it directly).
BATCH_ID=<uuid>

gcloud run jobs execute lead-batch-runner \
  --region=$REGION \
  --update-env-vars="BATCH_ID=$BATCH_ID" \
  --wait
```

Then check Supabase: the batch row should flip running → done with
`scraped_count` and `rejected_count` populated.

If it fails, check logs:
```bash
gcloud run jobs executions list --job=lead-batch-runner --region=$REGION
gcloud run jobs executions logs <execution-name> --region=$REGION
```

---

## 11. End-to-end test from the dashboard

After Vercel has redeployed with the new env vars:

1. Open the dashboard, click **+ New batch**.
2. Set `niche=plumber`, `city=Austin, TX`, `limit=20`.
3. Submit. The route handler should now return `runner: "cloud-run"` in the
   response (visible in the browser Network tab).
4. The batch detail page polls every 3s. Job typically completes in 30-90s
   for a 20-lead scrape — way under the old Vercel cap.

If the API returns `runner: "vercel"` instead, your env vars aren't being
read — double-check Vercel settings + redeploy.

---

## Updating the image

Every code change to anything imported by `cloud-run-job.ts` (orchestrator,
stages, services, lib) needs a fresh image:

```bash
gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT_ID/leadgen-jobs/runner:latest .
gcloud run jobs update lead-batch-runner \
  --region=$REGION \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/leadgen-jobs/runner:latest
```

Subsequent executions pick up the new image automatically.

---

## Rolling back

The Vercel route handler falls back to the old `waitUntil` path if any of
the four `GCP_*` env vars are unset. To roll back without a redeploy:

1. Vercel → Settings → Environment Variables → remove `GCP_PROJECT_ID`.
2. Redeploy.

The dashboard reverts to inline scrapes (with the 60s cap) until you
restore the var.

---

## Cost

Cloud Run Jobs free tier: 240k vCPU-seconds, 450k GiB-seconds, 2M requests
per month. A 60-second 1-vCPU/512-MiB run uses 60 vCPU-sec + 30 GiB-sec, so
the free tier alone covers ~4000 scrapes/month. Past that: fractions of a
cent per job.

Cloud Build free tier: 120 build-minutes/day. Image rebuilds take ~3 min.
