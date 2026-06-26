# OCTO MCP server — builds and runs the Streamable HTTP server (dist/serve.js),
# which also serves the read-only REST facade (/api/octo/*) for backend callers.
#
# Secrets are NEVER baked in — they come from the environment (GSM-synced) at run
# time. The pm2 deploy (ecosystem.config.cjs + scripts/deploy.sh) is the primary
# path today; this Dockerfile is the alternative/containerized option (WS-0.2).

# ---- build ----
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# serve.ts reads ../web/index.html and ../media/* relative to dist/ — ship them.
COPY web ./web
COPY media ./media
# Secrets via env (GSM), not COPY. .env is gitignored / not present in the image.
EXPOSE 8790
CMD ["node", "dist/serve.js"]
