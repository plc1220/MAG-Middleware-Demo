#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PROJECT="${GOOGLE_CLOUD_PROJECT:-my-rd-coe-demo-gen-ai}"
REGION="asia-southeast1"
ZONE="asia-southeast1-a"
NETWORK="mag-bayno-vpc"
SUBNET="mag-bayno-subnet"
ADDRESS="mag-bayno-demo-ip"
INSTANCE="mag-bayno-demo"
VM_SA="mag-bayno-transport-vm@${PROJECT}.iam.gserviceaccount.com"
DB_SECRET="mag-bayno-postgres-password"
PRIVATE_DIR="$ROOT/infra/private"
GENERATOR_KEY="$ROOT/sftp-demo/secrets/client_ed25519"
CONNECTOR_KEY="$PRIVATE_DIR/sftp_source_rsa"

command -v gcloud >/dev/null || { echo 'gcloud is required.' >&2; exit 1; }
mkdir -p "$PRIVATE_DIR" "$ROOT/sftp-demo/secrets"
chmod 0700 "$PRIVATE_DIR" "$ROOT/sftp-demo/secrets"

if [[ ! -s "$GENERATOR_KEY" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C 'mag-bayno-demo-generator' -f "$GENERATOR_KEY"
fi
if [[ ! -s "$CONNECTOR_KEY" ]]; then
  ssh-keygen -q -t rsa -b 3072 -m PEM -N '' -C 'mag-bayno-demo-confluent-source' -f "$CONNECTOR_KEY"
fi
chmod 0600 "$GENERATOR_KEY" "$CONNECTOR_KEY"

if ! gcloud secrets describe "$DB_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud secrets create "$DB_SECRET" --replication-policy=automatic --project="$PROJECT" >/dev/null
fi
if ! gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --filter='state=ENABLED' --limit=1 --format='value(name)' | grep -q .; then
  openssl rand -hex 32 | gcloud secrets versions add "$DB_SECRET" --data-file=- --project="$PROJECT" >/dev/null
fi

if ! gcloud iam service-accounts describe "$VM_SA" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create mag-bayno-transport-vm --project="$PROJECT" --display-name='MAG BAYNO transport VM' >/dev/null
fi
for attempt in {1..12}; do
  gcloud iam service-accounts describe "$VM_SA" --project="$PROJECT" >/dev/null 2>&1 && break
  sleep 5
done
gcloud iam service-accounts describe "$VM_SA" --project="$PROJECT" >/dev/null
gcloud secrets add-iam-policy-binding "$DB_SECRET" \
  --member="serviceAccount:${VM_SA}" --role=roles/secretmanager.secretAccessor \
  --condition=None --project="$PROJECT" --quiet >/dev/null

python3 - "$ROOT" "$PROJECT" <<'PY'
import base64, json, subprocess, sys, urllib.request
root, project = sys.argv[1:]
raw = subprocess.check_output(['gcloud','secrets','versions','access','latest','--secret=mag-bayno-confluent-mcp-auth','--project='+project], text=True)
key, secret = raw.split(':', 1)
auth = base64.b64encode(f'{key}:{secret}'.encode()).decode()
url = 'https://api.confluent.cloud/networking/v1/ip-addresses?cloud=GCP&region=asia-southeast1&services=CONNECT&address_type=EGRESS'
request = urllib.request.Request(url, headers={'Authorization':'Basic '+auth, 'Accept':'application/json'})
with urllib.request.urlopen(request, timeout=30) as response:
    payload = json.load(response)
cidrs = sorted({item['ip_prefix'] for item in payload.get('data', []) if item.get('address_type') == 'EGRESS' and 'CONNECT' in item.get('services', [])})
if not cidrs:
    raise SystemExit('Confluent returned no GCP asia-southeast1 connector egress ranges')
open(root + '/infra/private/confluent-egress-cidrs', 'w').write(','.join(cidrs))
print(f'Retrieved {len(cidrs)} shared regional Confluent connector egress ranges.')
PY
CIDRS="$(cat "$PRIVATE_DIR/confluent-egress-cidrs")"
METADATA_CIDRS="${CIDRS//,/;}"

if ! gcloud compute networks describe "$NETWORK" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud compute networks create "$NETWORK" --project="$PROJECT" --subnet-mode=custom --bgp-routing-mode=regional >/dev/null
fi
if ! gcloud compute networks subnets describe "$SUBNET" --project="$PROJECT" --region="$REGION" >/dev/null 2>&1; then
  gcloud compute networks subnets create "$SUBNET" --project="$PROJECT" --network="$NETWORK" \
    --region="$REGION" --range=10.74.0.0/24 >/dev/null
fi
if ! gcloud compute addresses describe "$ADDRESS" --project="$PROJECT" --region="$REGION" >/dev/null 2>&1; then
  gcloud compute addresses create "$ADDRESS" --project="$PROJECT" --region="$REGION" --network-tier=PREMIUM >/dev/null
fi
if ! gcloud compute firewall-rules describe mag-bayno-sftp-iap --project="$PROJECT" >/dev/null 2>&1; then
  gcloud compute firewall-rules create mag-bayno-sftp-iap --project="$PROJECT" --network="$NETWORK" \
    --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20 \
    --target-tags=mag-bayno-transport >/dev/null
fi
if ! gcloud compute firewall-rules describe mag-bayno-postgres-confluent --project="$PROJECT" >/dev/null 2>&1; then
  gcloud compute firewall-rules create mag-bayno-postgres-confluent --project="$PROJECT" --network="$NETWORK" \
    --direction=INGRESS --action=ALLOW --rules=tcp:5432 --source-ranges="$CIDRS" \
    --target-tags=mag-bayno-transport >/dev/null
fi
if ! gcloud compute firewall-rules describe mag-bayno-postgres-vpc --project="$PROJECT" >/dev/null 2>&1; then
  gcloud compute firewall-rules create mag-bayno-postgres-vpc --project="$PROJECT" --network="$NETWORK" \
    --direction=INGRESS --action=ALLOW --rules=tcp:5432 --source-ranges=10.74.0.0/24 \
    --target-tags=mag-bayno-transport >/dev/null
fi

if ! gcloud compute instances describe "$INSTANCE" --project="$PROJECT" --zone="$ZONE" >/dev/null 2>&1; then
  KEYS="$(cat "$GENERATOR_KEY.pub" "$CONNECTOR_KEY.pub")"
  gcloud compute instances create "$INSTANCE" --project="$PROJECT" --zone="$ZONE" \
    --machine-type=e2-micro --network="$NETWORK" --subnet="$SUBNET" \
    --address="$ADDRESS" --private-network-ip=10.74.0.2 --network-tier=PREMIUM --tags=mag-bayno-transport \
    --boot-disk-size=20GB --boot-disk-type=pd-standard --image-family=debian-12 \
    --image-project=debian-cloud --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --service-account="$VM_SA" --scopes=https://www.googleapis.com/auth/cloud-platform \
    --metadata="confluent-egress-cidrs=${METADATA_CIDRS},magdemo-ssh-keys=${KEYS}" \
    --metadata-from-file=startup-script="$ROOT/infra/mag-bayno-vm/startup.sh" \
    --labels=app=mag-bayno-demo,role=transport-db >/dev/null
else
  echo 'The MAG BAYNO VM already exists; preserving its state.'
fi

IP="$(gcloud compute addresses describe "$ADDRESS" --project="$PROJECT" --region="$REGION" --format='value(address)')"
echo "MAG BAYNO VM provisioning submitted. Instance=${INSTANCE} zone=${ZONE} external_ip=${IP}"
echo 'Wait for startup to finish before creating the SFTP and JDBC connectors.'
