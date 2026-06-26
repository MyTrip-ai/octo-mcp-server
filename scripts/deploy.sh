#!/usr/bin/env bash
#
# Human-run deploy for the OCTO MCP server. Run ON the host (staging first, then
# octo.mytrip.ai / mytrip-prod). The AI never runs this.
#
# Steps: pull -> sync secrets from GSM -> install + build -> pm2 reload -> health-gate.
#
# ⚠️ mytrip-prod also runs PRODUCTION Express + Payload. Validate on staging first.
#
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

echo "[deploy] git pull (ff-only)"
git pull --ff-only

echo "[deploy] sync secrets from GSM -> .env"
bash scripts/sync-secrets.sh

echo "[deploy] npm ci && build"
npm ci
npm run build

echo "[deploy] pm2 startOrReload"
pm2 startOrReload ecosystem.config.cjs --update-env

echo "[deploy] health-gate on /healthz"
for _ in $(seq 1 30); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8790/healthz 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then echo "[deploy] healthy ✓"; exit 0; fi
  sleep 1
done

echo "[deploy] HEALTH CHECK FAILED (last code: ${code:-?}) — inspect: pm2 logs octo-mcp" >&2
exit 1
