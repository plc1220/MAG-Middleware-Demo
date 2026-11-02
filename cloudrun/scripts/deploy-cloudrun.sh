#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-my-rd-coe-demo-gen-ai}"
REGION="asia-southeast1"
SERVICE="mag-bayno-site"
SERVICE_ACCOUNT="mag-bayno-site-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
MCP_SECRET="mag-bayno-confluent-mcp-auth"
GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-452883396851-0du09eabj8qt3le8bh7l6h2hs7ne6ppl.apps.googleusercontent.com}"
SESSION_SECRET="mag-bayno-site-session-secret"
DB_PASSWORD_SECRET="mag-bayno-web-postgres-password"
DB_CA_SECRET="mag-bayno-postgres-ca"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if ! gcloud projects describe "$PROJECT_ID" --project="$PROJECT_ID" --format='value(projectId)' >/dev/null; then
  printf 'Could not access GCP project %s. Refresh gcloud authentication and project permissions first.\n' "$PROJECT_ID" >&2
  exit 1
fi

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com aiplatform.googleapis.com secretmanager.googleapis.com --project="$PROJECT_ID"

if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create mag-bayno-site-runtime --project="$PROJECT_ID" --display-name="MAG BAYNO Cloud Run site"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SERVICE_ACCOUNT}" --role="roles/aiplatform.user" --condition=None --quiet >/dev/null

ensure_secret() {
  local secret_name="$1"
  if ! gcloud secrets describe "$secret_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$secret_name" --replication-policy=automatic --project="$PROJECT_ID" >/dev/null
  fi
}

has_enabled_version() {
  gcloud secrets versions list "$1" --project="$PROJECT_ID" --filter='state=ENABLED' --limit=1 --format='value(name)' | grep -q .
}

ensure_secret "$MCP_SECRET"
ensure_secret "$SESSION_SECRET"
ensure_secret "$DB_PASSWORD_SECRET"
ensure_secret "$DB_CA_SECRET"

if ! has_enabled_version "$MCP_SECRET"; then
  printf 'Enter the Confluent Global API key for the MAG assistant. Input is hidden.\n'
  read -r -s -p 'API key: ' MCP_API_KEY
  printf '\n'
  read -r -s -p 'API secret: ' MCP_API_SECRET
  printf '\n'
  if [[ -z "$MCP_API_KEY" || -z "$MCP_API_SECRET" ]]; then
    printf 'Both Confluent values are required.\n' >&2
    exit 2
  fi
  printf '%s:%s' "$MCP_API_KEY" "$MCP_API_SECRET" | gcloud secrets versions add "$MCP_SECRET" --data-file=- --project="$PROJECT_ID" >/dev/null
  unset MCP_API_KEY MCP_API_SECRET
fi

if ! has_enabled_version "$SESSION_SECRET"; then
  openssl rand -base64 48 | gcloud secrets versions add "$SESSION_SECRET" --data-file=- --project="$PROJECT_ID" >/dev/null
fi

for secret_name in "$MCP_SECRET" "$SESSION_SECRET" "$DB_PASSWORD_SECRET" "$DB_CA_SECRET"; do
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None \
    --project="$PROJECT_ID" \
    --quiet >/dev/null
done

for secret_name in "$MCP_SECRET" "$SESSION_SECRET" "$DB_PASSWORD_SECRET" "$DB_CA_SECRET"; do
  if ! has_enabled_version "$secret_name"; then
    printf 'Secret %s has no enabled version; refusing to deploy an incomplete runtime.\n' "$secret_name" >&2
    exit 2
  fi
done

gcloud run deploy "$SERVICE" \
  --source="$SCRIPT_DIR/.." \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --service-account="$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --min=0 \
  --max=1 \
  --memory=1Gi \
  --cpu=1 \
  --concurrency=10 \
  --timeout=180 \
  --network=mag-bayno-vpc \
  --subnet=mag-bayno-subnet \
  --vpc-egress=private-ranges-only \
  --set-env-vars="GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID},PUBLIC_ORIGIN=https://mag-bayno-site-452883396851.asia-southeast1.run.app,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GEMINI_MODEL=gemini-3.5-flash,CONFLUENT_ENV_ID=env-pozpjk,CONFLUENT_ORG_ID=77c1b28e-7cc7-48b6-a48a-dad646769755,CONFLUENT_CLUSTER_ID=lkc-pg690ym,CONFLUENT_COMPUTE_POOL_ID=lfcp-rr606r7,CONFLUENT_GLOBAL_MCP_URL=https://api.confluent.cloud/mcp/v1,CONFLUENT_REGIONAL_MCP_URL=https://mcp.asia-southeast1.gcp.confluent.cloud/mcp/v1/organizations/77c1b28e-7cc7-48b6-a48a-dad646769755,BAYNO_DB_HOST=10.74.0.2,BAYNO_DB_NAME=magbayno,BAYNO_DB_USER=bayno_web_login,BAYNO_DB_TLS_NAME=mag-bayno-demo" \
  --set-secrets="CONFLUENT_MCP_API_AUTH=${MCP_SECRET}:latest,SITE_SESSION_SECRET=${SESSION_SECRET}:latest,BAYNO_DB_PASSWORD=${DB_PASSWORD_SECRET}:latest,BAYNO_DB_CA=${DB_CA_SECRET}:latest"
