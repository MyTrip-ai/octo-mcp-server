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
  const child = spawn(process.execPath, [SERVE], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", OCTO_ALLOWED_HOSTS: "" }, stdio: "ignore" });
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
  } finally {
    child.kill("SIGKILL");
  }

  console.log(`\n${failures === 0 ? "✅ SERVE SMOKE PASSED" : "❌ " + failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
