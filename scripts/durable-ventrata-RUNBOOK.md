# Make prod Ventrata config durable across redeploys — handoff runbook

**Why:** the live Edinburgh/Scotland supplier needs `VENTRATA_OCTO_API_KEY`. It is
currently only in the box `.env` (hand-placed 2026-06-30). Per policy, GSM is the
canonical store and the next `sync-secrets.sh`/`deploy.sh` overwrites `.env` — so the
key must live in **GSM** for the config to survive a clean redeploy or fresh clone.

The AI cannot do steps 1–2: the box's active gcloud identity is a read-only reader SA
(`staging-gsm-reader-v2`), and per `DEPLOY.md` the AI never deploys. Run these yourself
with an admin identity (`jason@mytrip.ai`).

---

## Step 1 — create the GSM secret (admin identity; value piped, never printed)

Run **on mytrip-prod** (`ssh jason@49.13.61.134`). Reads the value straight from the
current working `.env`, so you never type or echo the key:

```bash
val=$(mktemp)
grep '^VENTRATA_OCTO_API_KEY=' /home/jason/octo-mcp-server/.env | cut -d= -f2- | tr -d '\r\n' > "$val"
gcloud --account=jason@mytrip.ai secrets create platform_ventrata_octo_api_key \
  --project=mytrip-prod-2026 --replication-policy=automatic --data-file="$val"
rm -f "$val"
```

If the secret already exists, add a new version instead:

```bash
val=$(mktemp)
grep '^VENTRATA_OCTO_API_KEY=' /home/jason/octo-mcp-server/.env | cut -d= -f2- | tr -d '\r\n' > "$val"
gcloud --account=jason@mytrip.ai secrets versions add platform_ventrata_octo_api_key \
  --project=mytrip-prod-2026 --data-file="$val"
rm -f "$val"
```

## Step 2 — confirm the sync reader SA can access it

`sync-secrets.sh` authenticates with the SA key file `/etc/gcp/production-gsm-reader.json`
(NOT the active account). If that SA has project-wide `roles/secretmanager.secretAccessor`,
nothing more is needed. If access is per-secret, grant it (replace with that SA's email):

```bash
gcloud --account=jason@mytrip.ai secrets add-iam-policy-binding platform_ventrata_octo_api_key \
  --project=mytrip-prod-2026 \
  --member="serviceAccount:PRODUCTION_GSM_READER_SA_EMAIL" \
  --role=roles/secretmanager.secretAccessor
```

## Step 3 — ship the script hardening (this repo)

The repo now treats `VENTRATA_OCTO_API_KEY` as REQUIRED and the facade/anthropic
secrets as OPTIONAL (skipped if absent) so the sync no longer hard-fails before they
exist. Changed files: `scripts/sync-secrets.sh`, `DEPLOY.md`. Commit + push to
`MyTrip-ai/octo-mcp-server`, then on the box: `cd /home/jason/octo-mcp-server && git pull --ff-only`.

## Step 4 — validate the durable path actually reconstructs .env from GSM

On the box (this rewrites `.env` from GSM and restarts only the isolated `octo-mcp`):

```bash
cd /home/jason/octo-mcp-server
bash scripts/sync-secrets.sh          # expect: "Wrote .../.env — 1 secret(s) + config"
grep -c '^VENTRATA_OCTO_API_KEY=' .env # expect: 1
pm2 restart octo-mcp --update-env
```

Then confirm the live supplier (from anywhere):

```bash
curl -s -X POST https://octo.mytrip.ai/api/chat -H 'content-type: application/json' \
  -d '{"sessionId":"durable-check","message":"day trips from Edinburgh"}' | head -c 200
# expect: "Found NN options ..." (ventrata-edinexplore products)
```

If Step 4 prints products, the config is durable: any future `deploy.sh` (pull → sync
from GSM → build → reload) reconstructs the Ventrata `.env` automatically.

## Safety net

A backup of the pre-change `.env` is at `/home/jason/octo-mcp-server/.env.bak-20260630-ventrata`.
