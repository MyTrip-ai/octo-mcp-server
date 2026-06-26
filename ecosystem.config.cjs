/**
 * pm2 process config for the OCTO MCP server (live at octo.mytrip.ai).
 *
 * Captures the running `octo-mcp` pm2 process AS CODE (WS-0.2). Today the process
 * is supervised by pm2 on the box but was never committed — this is that capture.
 *
 * Secrets are NOT here. The app reads them from the repo-root .env (src/config.ts
 * loadEnv), which scripts/sync-secrets.sh writes from Google Secret Manager. This
 * file holds only non-secret config + supervision settings.
 *
 * ⚠️ RECONCILE before adopting: run `pm2 describe octo-mcp` on the box and confirm
 *    name / script / cwd / interpreter match. Then `pm2 startOrReload ecosystem.config.cjs`.
 */
module.exports = {
  apps: [
    {
      name: "octo-mcp",
      script: "dist/serve.js",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "256M",
      // Non-secret config. serve.ts also has sane defaults; .env (GSM-synced) wins for secrets.
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "8790",
        OCTO_ALLOWED_HOSTS: "octo.mytrip.ai",
        OCTO_PUBLIC_URL: "https://octo.mytrip.ai",
      },
    },
  ],
};
