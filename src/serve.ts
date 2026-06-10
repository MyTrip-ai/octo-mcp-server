#!/usr/bin/env node
/**
 * Remote MCP endpoint — Streamable HTTP transport (Tier 2).
 *
 * Lets remote clients (ChatGPT connectors, remote Claude/Cursor) reach the OCTO
 * server over HTTPS. Session-based: each MCP session gets its own McpServer (and
 * its own cart/booking state), keyed by the `mcp-session-id` header.
 *
 * Binds localhost by default — put a TLS-terminating reverse proxy (nginx) in front.
 *   PORT=8790  HOST=127.0.0.1  OCTO_ALLOWED_HOSTS=octo.mytrip.ai  node dist/serve.js
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { loadEnv } from "./config.js";
import { createServer } from "./server.js";

loadEnv();
const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? "127.0.0.1";
const ALLOWED_HOSTS = (process.env.OCTO_ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const transports = new Map<string, StreamableHTTPServerTransport>();

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1_000_000) { reject(new Error("payload too large")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(body ? JSON.parse(body) : undefined); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, mcp-protocol-version, last-event-id");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

const HOME = `<!doctype html><meta charset=utf-8><title>OCTO MCP (unofficial)</title>
<body style="font:16px/1.6 system-ui;max-width:40rem;margin:6rem auto;padding:0 1rem;color:#241f18;background:#f3ead8">
<h1>OCTO MCP — unofficial demo</h1>
<p>This is a remote <a href="https://modelcontextprotocol.io">Model Context Protocol</a> endpoint for the
open <a href="https://octo.travel">OCTO standard</a>. The MCP endpoint is <code>/mcp</code>.</p>
<p>Add it to an MCP client that supports remote/HTTP servers (e.g. ChatGPT connectors) using this URL.
Unofficial · not affiliated with OCTO · mock + test data only.</p>
<p><a href="https://github.com/MyTrip-ai/octo-mcp-server">github.com/MyTrip-ai/octo-mcp-server</a></p>`;

const http = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (req.method === "GET" && (req.url === "/healthz" || req.url === "/health")) {
    res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true,"service":"octo-mcp"}');
    return;
  }
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(HOME);
    return;
  }
  if (!req.url || !req.url.startsWith("/mcp")) { res.writeHead(404).end("not found"); return; }

  try {
    const sid = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST") {
      const body = await readJson(req);
      let transport = sid ? transports.get(sid) : undefined;

      if (!transport && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          ...(ALLOWED_HOSTS.length ? { enableDnsRebindingProtection: true, allowedHosts: ALLOWED_HOSTS } : {}),
          onsessioninitialized: (id) => { transports.set(id, transport!); },
        });
        transport.onclose = () => { if (transport!.sessionId) transports.delete(transport!.sessionId); };
        await createServer().connect(transport);
      } else if (!transport) {
        res.writeHead(400, { "content-type": "application/json" }).end(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session; send an initialize request first." }, id: null }),
        );
        return;
      }
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const transport = sid ? transports.get(sid) : undefined;
      if (!transport) { res.writeHead(400).end("No valid session"); return; }
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405).end("method not allowed");
  } catch (e) {
    console.error("[octo-http] error:", e instanceof Error ? e.message : e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null }));
  }
});

http.listen(PORT, HOST, () => {
  console.error(`[octo-http] OCTO MCP (Streamable HTTP) on http://${HOST}:${PORT}/mcp  ·  health /healthz` + (ALLOWED_HOSTS.length ? `  ·  allowedHosts: ${ALLOWED_HOSTS.join(", ")}` : "  ·  DNS-rebind protection OFF (set OCTO_ALLOWED_HOSTS in prod)"));
});
