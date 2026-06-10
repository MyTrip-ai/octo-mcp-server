/**
 * Chat bridge — connects a browser chat to the OCTO MCP server.
 *
 *   browser  →  HTTP (/api/chat)  →  THIS bridge (a real MCP client)
 *            →  stdio  →  octo-mcp-server  →  OCTO suppliers (mock + live Ventrata)
 *
 * The conversation logic lives in src/chat/engine.ts (shared with the CLI). This
 * file is just the HTTP transport + static serving.
 *
 * Run:  npm run bridge   →  open http://localhost:8787
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../src/config.js";
import { connectMcp, ChatEngine } from "../src/chat/engine.js";

loadEnv();
const PORT = Number(process.env.PORT ?? 8787);
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? "";
const MODEL = process.env.OCTO_CHAT_MODEL ?? "claude-sonnet-4-6";
const INDEX_HTML = fileURLToPath(new URL("../web/index.html", import.meta.url));
const SERVER_ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const mcp = await connectMcp(SERVER_ENTRY, "octo-chat-bridge");
const engine = new ChatEngine({ callTool: mcp.callTool, toolList: mcp.toolList, anthropicKey: ANTHROPIC_KEY || undefined, model: MODEL });
console.error(`[bridge] connected to MCP server — ${mcp.toolList.length} tools, brain=${engine.brain}`);

function cors(res: import("node:http").ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (req.method === "GET" && req.url === "/favicon.ico") { res.writeHead(204).end(); return; }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    try { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(INDEX_HTML)); }
    catch { res.writeHead(500).end("index.html not found"); }
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, brain: engine.brain, tools: mcp.toolList.length }));
    return;
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { sessionId = "default", message = "" } = JSON.parse(body || "{}");
        const result = await engine.respond(sessionId, message);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ reply: `Sorry — something went wrong: ${e instanceof Error ? e.message : String(e)}` }));
      }
    });
    return;
  }
  res.writeHead(404).end("not found");
}).listen(PORT, () => console.error(`[bridge] http://localhost:${PORT}  →  open it in your browser`));
