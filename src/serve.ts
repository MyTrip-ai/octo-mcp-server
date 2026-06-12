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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { loadEnv } from "./config.js";
import { createServer } from "./server.js";
import { ChatEngine } from "./chat/engine.js";

loadEnv();
const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? "127.0.0.1";
const ALLOWED_HOSTS = (process.env.OCTO_ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const transports = new Map<string, StreamableHTTPServerTransport>();

// ── In-page "try it" chat ───────────────────────────────────────────────────
// Serve the browser chat (web/index.html) and back it with the SAME OCTO tools,
// over an in-process MCP link (no subprocess). Conversation state is isolated
// per browser sessionId inside ChatEngine. Init is non-blocking: the MCP/landing
// endpoints come up immediately and the chat flips on when ready.
const WEB_HTML = (() => {
  try { return readFileSync(fileURLToPath(new URL("../web/index.html", import.meta.url)), "utf8"); }
  catch { return ""; }
})();
let chatEngine: ChatEngine | null = null;
let chatTools = 0;

async function initChat(): Promise<void> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const mcp = createServer();
  const client = new Client({ name: "octo-web-chat", version: "0.1.0" });
  await Promise.all([mcp.connect(serverT), client.connect(clientT)]);
  const toolList = (await client.listTools()).tools;
  chatTools = toolList.length;
  const callTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const r = await client.callTool({ name, arguments: args });
    const content = (r.content ?? []) as Array<{ type: string; text?: string }>;
    return content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
  };
  chatEngine = new ChatEngine({
    callTool, toolList,
    anthropicKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || undefined,
    model: process.env.OCTO_CHAT_MODEL || "claude-sonnet-4-6",
  });
}

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

/** Public origin as seen by the visitor (honours the TLS proxy + an env override). */
function publicOrigin(req: IncomingMessage): string {
  if (process.env.OCTO_PUBLIC_URL) return process.env.OCTO_PUBLIC_URL.replace(/\/+$/, "");
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "octo.mytrip.ai";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  return `${proto}://${host}`;
}

/** Does this request come from a browser (wants HTML) rather than an MCP client? */
function wantsHtml(req: IncomingMessage): boolean {
  const a = String(req.headers["accept"] ?? "");
  return a.includes("text/html") && !a.includes("text/event-stream");
}

const TOOLS: Array<[string, string]> = [
  ["list_suppliers", "Browse the connected OCTO suppliers"],
  ["search_products", "Find tours & activities by keyword"],
  ["get_product_details", "Full details, options & pricing"],
  ["check_availability", "Open dates and time-slot handles"],
  ["create_hold", "Reserve a slot — does not charge"],
  ["confirm_booking", "Confirm, only after a human approves"],
  ["cancel_booking", "Release a hold or booking"],
  ["get_booking", "Look up a booking by reference"],
  ["list_bookings", "Bookings made this session"],
];

const STYLE = `:root{--bg:#f3ead8;--card:#fbf6ec;--ink:#241f18;--mut:#6b5d49;--line:#e3d6bd;--acc:#b4502b;--ok:#2f7d5b}
*{box-sizing:border-box}body{margin:0;font:16px/1.65 'Hanken Grotesk',system-ui,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{max-width:54rem;margin:0 auto;padding:3.5rem 1.25rem 5rem}
.badge{display:inline-flex;align-items:center;gap:.5rem;font:500 .78rem/1 'Hanken Grotesk',sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);border:1px solid var(--line);background:var(--card);padding:.45rem .75rem;border-radius:999px}
.dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--ok);animation:p 2s infinite}
@keyframes p{0%{box-shadow:0 0 0 0 rgba(47,125,91,.45)}70%{box-shadow:0 0 0 .5rem rgba(47,125,91,0)}100%{box-shadow:0 0 0 0 rgba(47,125,91,0)}}
h1{font:600 clamp(2.4rem,7vw,3.6rem)/1.02 Fraunces,Georgia,serif;letter-spacing:-.02em;margin:1.4rem 0 .5rem}
.lede{font-size:1.2rem;color:var(--mut);max-width:38rem;margin:0 0 2rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.05rem 1.2rem;margin:1rem 0}
.ep{display:flex;align-items:center;gap:.85rem;flex-wrap:wrap}
.ep .k{font:500 .72rem/1 'Hanken Grotesk',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
code,kbd{font-family:'Space Mono',ui-monospace,monospace}
.url{font-family:'Space Mono',monospace;font-size:1.02rem;color:var(--acc);word-break:break-all}
button.copy{font:500 .8rem 'Hanken Grotesk',sans-serif;cursor:pointer;border:1px solid var(--line);background:var(--bg);color:var(--ink);padding:.38rem .72rem;border-radius:8px}
button.copy:hover{border-color:var(--acc);color:var(--acc)}
h2{font:600 1.5rem/1.1 Fraunces,Georgia,serif;margin:2.6rem 0 .9rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(15.5rem,1fr));gap:.6rem}
.tool{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.7rem .85rem}
.tool b{font:600 .92rem 'Space Mono',monospace;color:var(--ink)}
.tool span{display:block;color:var(--mut);font-size:.88rem;margin-top:.18rem}
.step{margin:.8rem 0}.step b{display:block;font-weight:600;margin-bottom:.15rem}.step p{margin:.1rem 0 0;color:var(--mut)}
pre{background:#241f18;color:#f3ead8;border-radius:10px;padding:.85rem 1rem;overflow:auto;font-size:.88rem;display:flex;justify-content:space-between;gap:1rem;align-items:center}
pre button.copy{background:#3a3226;border-color:#4a3f2e;color:#f3ead8}
footer{margin-top:3rem;padding-top:1.4rem;border-top:1px solid var(--line);color:var(--mut);font-size:.9rem}
a{color:var(--acc)}`;

const FONTS = `<link rel=preconnect href=https://fonts.googleapis.com><link rel=preconnect href=https://fonts.gstatic.com crossorigin>` +
  `<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Hanken+Grotesk:wght@400;500;600&family=Space+Mono&display=swap" rel=stylesheet>`;

const COPYJS = `<script>function copy(t,b){navigator.clipboard.writeText(t).then(function(){var o=b.textContent;b.textContent='copied ✓';setTimeout(function(){b.textContent=o},1200)})}</script>`;

function landing(origin: string): string {
  const ep = `${origin}/mcp`;
  const tools = TOOLS.map(([n, d]) => `<div class=tool><b>${n}</b><span>${d}</span></div>`).join("");
  return `<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>OCTO MCP — unofficial remote server</title>${FONTS}<style>${STYLE}</style>
<div class=wrap>
<span class=badge><span class=dot></span> Live · Unofficial demo</span>
<h1>OCTO MCP</h1>
<p class=lede>A remote <a href="https://modelcontextprotocol.io">Model Context Protocol</a> server for the open
<a href="https://octo.travel">OCTO standard</a> — so any AI assistant can search, hold, and confirm tours &amp;
activities through OCTO's reserve-then-confirm booking flow.</p>

<div class=card><div class=ep><span class=k>Endpoint</span>
<span class="url">${ep}</span>
<button class=copy onclick="copy('${ep}',this)">copy</button></div></div>

<h2>What it exposes</h2>
<div class=grid>${tools}</div>

<h2>Connect your AI</h2>
<div class=card>
<div class=step><b>ChatGPT</b><p>Settings → Connectors → Create. Paste the endpoint URL. (Needs a plan with custom connectors / developer mode.)</p></div>
<div class=step><b>Claude.ai &amp; Claude Desktop</b><p>Settings → Connectors → Add custom connector. Paste the endpoint URL.</p></div>
<div class=step><b>Cursor · Windsurf · other MCP clients</b><p>Add a remote / Streamable-HTTP MCP server pointing at the URL above.</p></div>
</div>
<div class=step><b>Claude Code (terminal)</b></div>
<pre><code>claude mcp add --transport http octo ${ep}</code><button class=copy onclick="copy('claude mcp add --transport http octo ${ep}',this)">copy</button></pre>

<footer>Unofficial · not affiliated with OCTO · mock &amp; test data only. ·
<a href="https://github.com/MyTrip-ai/octo-mcp-server">source on GitHub</a> ·
<a href="https://octo.travel">OCTO standard</a> · <a href="https://modelcontextprotocol.io">MCP</a></footer>
</div>${COPYJS}`;
}

const http = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (req.method === "GET" && (req.url === "/healthz" || req.url === "/health")) {
    res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true,"service":"octo-mcp"}');
    return;
  }
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html" || req.url === "/try")) {
    // The Meridian "try it" chat page; fall back to the text landing if it can't be read.
    const html = WEB_HTML || landing(publicOrigin(req));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ ok: Boolean(chatEngine), brain: chatEngine?.brain ?? "starting", tools: chatTools }),
    );
    return;
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    if (!chatEngine) {
      res.writeHead(503, { "content-type": "application/json" }).end(
        JSON.stringify({ reply: "The live demo is warming up — try again in a few seconds." }),
      );
      return;
    }
    try {
      const body = (await readJson(req)) as { sessionId?: string; message?: string } | undefined;
      const result = await chatEngine.respond(body?.sessionId || "default", body?.message || "");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ reply: `Sorry — something went wrong: ${e instanceof Error ? e.message : String(e)}` }),
      );
    }
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
      if (!transport) {
        // A human opened /mcp in a browser — forward them to the real experience
        // (the try-it chat + connect instructions). MCP clients (event-stream /
        // no html) fall through to the correct protocol 400 below.
        if (req.method === "GET" && wantsHtml(req)) {
          res.writeHead(302, { location: `${publicOrigin(req)}/` }).end();
          return;
        }
        res.writeHead(400).end("No valid session");
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405).end("method not allowed");
  } catch (e) {
    console.error("[octo-http] error:", e instanceof Error ? e.message : e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null }));
  }
});

initChat()
  .then(() => console.error(`[octo-http] web chat ready — brain=${chatEngine?.brain}, ${chatTools} tools`))
  .catch((e) => console.error("[octo-http] web chat init failed (MCP endpoint unaffected):", e instanceof Error ? e.message : e));

http.listen(PORT, HOST, () => {
  console.error(`[octo-http] OCTO MCP (Streamable HTTP) on http://${HOST}:${PORT}/mcp  ·  health /healthz` + (ALLOWED_HOSTS.length ? `  ·  allowedHosts: ${ALLOWED_HOSTS.join(", ")}` : "  ·  DNS-rebind protection OFF (set OCTO_ALLOWED_HOSTS in prod)"));
});
