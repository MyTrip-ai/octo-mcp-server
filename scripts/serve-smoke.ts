/**
 * Smoke for the remote (Streamable HTTP) endpoint — boots dist/serve.js on a test
 * port and connects a REAL MCP client over HTTP, proving the transport + session.
 *
 * Run: npm run serve-smoke
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SERVE = fileURLToPath(new URL("../dist/serve.js", import.meta.url));
const PORT = 8791;

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  // Tiny caps so the bounds are actually exercised rather than asserted in theory.
  const child = spawn(process.execPath, [SERVE], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      OCTO_ALLOWED_HOSTS: "",
      OCTO_MAX_SESSIONS: "3",
      OCTO_CHAT_RATE_PER_IP: "2",
      OCTO_CHAT_MAX_MESSAGE_CHARS: "50",
    },
    stdio: "ignore",
  });
  try {
    await new Promise((r) => setTimeout(r, 1400));

    const health = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json()).catch(() => null);
    check("/healthz responds ok", !!health && (health as any).ok === true);

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`));
    const client = new Client({ name: "serve-smoke", version: "0.0.0" });
    await client.connect(transport);

    const tools = await client.listTools();
    check("MCP over HTTP lists 9 tools", tools.tools.length === 9, `${tools.tools.length}`);
    check("session id was established", !!transport.sessionId, transport.sessionId ?? "none");

    const r = await client.callTool({ name: "list_suppliers", arguments: {} });
    const text = ((r.content ?? []) as Array<{ type: string; text?: string }>).map((c) => (c.type === "text" ? c.text : "")).join("\n");
    check("list_suppliers over HTTP returns suppliers", /supplier/i.test(text));

    await client.close();

    // ── Security regressions (AT-QA PLAN-20260901) ──────────────────────────
    // If one of these fails, a control was removed — read the plan before
    // "fixing" the test.
    const chat = (msg: string) =>
      fetch(`http://127.0.0.1:${PORT}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: `smoke-${Math.random()}`, message: msg }),
      });

    // R3a — a single oversized prompt is refused before it reaches the LLM.
    const long = await chat("x".repeat(500));
    check("oversized chat message refused (429)", long.status === 429, `HTTP ${long.status}`);

    // R3b — per-IP ceiling. Booted with OCTO_CHAT_RATE_PER_IP=2, and the oversized
    // request above was rejected before it consumed budget, so 2 more are allowed.
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await chat("day trips")).status);
    check("per-IP chat rate limit engages", codes.includes(429), codes.join(","));

    // CORS belongs on /mcp only — the wildcard let any page drive this server
    // (including the LLM path) from its visitors' browsers.
    const rootCors = await fetch(`http://127.0.0.1:${PORT}/`);
    check("landing page sends no CORS wildcard", rootCors.headers.get("access-control-allow-origin") === null,
      String(rootCors.headers.get("access-control-allow-origin")));
    const mcpCors = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: "OPTIONS" });
    check("/mcp still sends CORS for browser MCP clients", mcpCors.headers.get("access-control-allow-origin") === "*");

    // F2 — the /mcp transport map is bounded (distinct from chatSessions).
    const opened: string[] = [];
    for (let i = 0; i < 6; i++) {
      const t = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`));
      const c = new Client({ name: `flood-${i}`, version: "0.0.0" });
      await c.connect(t);
      if (t.sessionId) opened.push(t.sessionId);
    }
    const rpc = (sid: string) =>
      fetch(`http://127.0.0.1:${PORT}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": sid },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    check("oldest mcp session evicted at cap 3", (await rpc(opened[0])).status === 400);
    check("newest mcp session survives eviction", (await rpc(opened[opened.length - 1])).status === 200);
  } finally {
    child.kill("SIGKILL");
  }

  console.log(`\n${failures === 0 ? "✅ SERVE SMOKE PASSED" : "❌ " + failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
