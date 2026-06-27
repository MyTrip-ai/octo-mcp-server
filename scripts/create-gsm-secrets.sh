#!/usr/bin/env bash
#
# One-time bootstrap: create the OCTO GSM secrets in mytrip-prod-2026 (WS-0.3).
#
# Run with an ADMIN-authed gcloud (e.g. jason@mytrip.ai) — the reader SAs cannot
# create. Secret VALUES are NEVER printed. Idempotent: existing secrets are left
# untouched. Reusable for the staging stand-up (the GSM project is shared).
#
#   1. gcloud auth login                 # interactive, admin account
#   2. bash scripts/create-gsm-secrets.sh
#
# Ventrata + Anthropic values are read from this checkout's .env. Override with
# OCTO_ENV_FILE if the values live elsewhere.
#
set -euo pipefail

PROJECT="${GCP_PROJECT:-mytrip-prod-2026}"
ENV_FILE="${OCTO_ENV_FILE:-$(cd "$(dirname "$0")/.." && pwd)/.env}"

active="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)"
echo "gcloud account : ${active:-<none>}"
echo "project        : $PROJECT"
echo "env source     : $ENV_FILE"
echo
[ -n "$active" ] || { echo "No active gcloud account. Run: gcloud auth login" >&2; exit 1; }

exists() { gcloud secrets describe "$1" --project="$PROJECT" >/dev/null 2>&1; }
create() { gcloud secrets create "$1" --project="$PROJECT" --replication-policy=automatic --data-file=- && echo "  ✓ created $1"; }

# Extract a value from .env WITHOUT printing it (last match; strip CR + surrounding quotes).
env_val() {
  [ -r "$ENV_FILE" ] || return 1
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- \
    | sed -e 's/\r$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# 1) platform_ventrata_octo_api_key  <- .env VENTRATA_OCTO_API_KEY
if exists platform_ventrata_octo_api_key; then
  echo "platform_ventrata_octo_api_key : exists — skip"
else
  v="$(env_val VENTRATA_OCTO_API_KEY || true)"
  if [ -z "${v:-}" ]; then
    echo "platform_ventrata_octo_api_key : VENTRATA_OCTO_API_KEY not in $ENV_FILE — SKIP (set OCTO_ENV_FILE)" >&2
  else
    printf '%s' "$v" | create platform_ventrata_octo_api_key
  fi
  unset v
fi

# 2) platform_octo_facade_token  <- NEW random (Express + the facade both read it from GSM)
if exists platform_octo_facade_token; then
  echo "platform_octo_facade_token     : exists — skip (not regenerating)"
else
  openssl rand -hex 32 | tr -d '\n' | create platform_octo_facade_token
fi

# 3) platform_anthropic_api_key  <- shared platform secret (web-chat brain)
if exists platform_anthropic_api_key; then
  echo "platform_anthropic_api_key     : exists — OK"
else
  echo "platform_anthropic_api_key     : not found. Existing anthropic/claude secrets:"
  gcloud secrets list --project="$PROJECT" --filter="name~anthropic OR name~claude" --format="value(name)" | sed 's/^/    /' || true
  v="$(env_val ANTHROPIC_API_KEY || true)"
  if [ -n "${v:-}" ]; then
    read -r -p "  Create platform_anthropic_api_key from $ENV_FILE? [y/N] " a || a="N"
    if [ "${a:-N}" = "y" ]; then printf '%s' "$v" | create platform_anthropic_api_key; else echo "  skipped"; fi
  else
    echo "  No ANTHROPIC_API_KEY in $ENV_FILE; reuse the existing secret name above in DEPLOY.md/sync-secrets.sh."
  fi
  unset v
fi

echo
echo "Verify (names only, no values):"
echo "  gcloud secrets list --project=$PROJECT --filter='name~octo OR name~ventrata OR name~anthropic' --format='table(name)'"
