# Deploy & operations — OCTO MCP server

The server runs at **`octo.mytrip.ai`**, which is **`mytrip-prod` (PRODUCTION)** —
the same box as the platform's prod `express-middleware` and `payload-backend`. It
is supervised by **pm2** as the process **`octo-mcp`** (binds `127.0.0.1:8790`;
nginx terminates TLS in front). Co-location means the MyTrip Express backend can
reach the read-only REST facade at `http://127.0.0.1:8790/api/octo/*` locally.

## Policy (non-negotiable)
- **The AI never deploys.** It prepares config/scripts; a human runs them.
- **Staging first.** There is no `octo-mcp` on staging yet — stand one up and
  validate before any prod redeploy, because this box runs prod Express/Payload.
- **Secrets live in GSM.** Rotate in GSM; never hand-edit `.env` (the next
  `sync-secrets.sh` overwrites it). `.env` is gitignored.

## Artifacts in this repo (WS-0.2 / WS-0.3)
| File | Purpose |
|------|---------|
| `ecosystem.config.cjs` | pm2 process definition (the running `octo-mcp`, as code). Non-secret env only. |
| `scripts/sync-secrets.sh` | Writes `./.env` from GSM using the box's GSM-reader SA. Never prints values. |
| `scripts/deploy.sh` | Human-run: pull → sync secrets → build → `pm2 startOrReload` → health-gate. |
| `Dockerfile` + `.dockerignore` | Alternative containerized run (secrets via env, never baked in). |

## GSM secrets (project `mytrip-prod-2026`) — create these first
| env var | GSM secret name | notes |
|---------|-----------------|-------|
| `VENTRATA_OCTO_API_KEY` | `platform_ventrata_octo_api_key` | the live Ventrata OCTO Bearer key (currently only in the box `.env`) |
| `OCTO_FACADE_TOKEN` | `platform_octo_facade_token` | **NEW** — internal Express↔facade bearer; generate a random token |
| `ANTHROPIC_API_KEY` | `platform_anthropic_api_key` | web-chat brain; **confirm the canonical platform name** before relying on it |

Non-secret config written by the sync script: `HOST`, `PORT`, `OCTO_ALLOWED_HOSTS`,
`OCTO_PUBLIC_URL`, `VENTRATA_OCTO_ENDPOINT`, `VENTRATA_OCTO_CURRENCY`.

## First-time deploy (human, on the host)
```bash
# 0. (one-time) create the three GSM secrets above in project mytrip-prod-2026
# 1. on the box, in the repo checkout (/home/jason/octo-mcp-server):
bash scripts/deploy.sh
# 2. verify the facade (needs the bearer token):
curl -s -H "Authorization: Bearer $OCTO_FACADE_TOKEN" http://127.0.0.1:8790/api/octo/suppliers
```

## ⚠️ Reconcile before first adoption
These artifacts encode assumptions from read-only recon — confirm against the box:
- `pm2 describe octo-mcp` → confirm `script` / `cwd` / `interpreter` match `ecosystem.config.cjs`.
- Confirm `VENTRATA_OCTO_ENDPOINT` and the GSM secret names above (the three secrets do **not** exist in GSM yet).
- Capture the nginx vhost for `octo.mytrip.ai → 127.0.0.1:8790` (not yet in-repo).

## Health
- `GET /healthz` → `{"ok":true,"service":"octo-mcp"}` (process up).
- `GET /api/health` → web-chat readiness (separate from the facade).
