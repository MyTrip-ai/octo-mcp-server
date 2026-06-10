/**
 * Non-interactive smoke for `connect` (multi-client). Exercises the client
 * registry, the stable install command, the generalized config writer, the
 * snippet output, and the server handshake — against TEMP files only. (ISC-9/10)
 *
 * Run: npm run connect-smoke
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIENTS, getClient, INSTALL, INSTALL_STR, detectedClients } from "../src/cli/clients.js";
import { upsertServerEntry, verifyServer, runConnect } from "../src/cli/connect.js";
import { bufferIO } from "../src/cli/ui.js";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  // stable, path-independent install command
  check("install command is stable npx-from-GitHub (no dead path)",
    INSTALL.command === "npx" && INSTALL.args.includes("github:MyTrip-ai/octo-mcp-server") && INSTALL.args.includes("octo-mcp-server-stdio"),
    INSTALL_STR);

  // registry coverage
  const ids = CLIENTS.map((c) => c.id);
  check("registry covers the key clients", ["claude-code", "claude-desktop", "cursor", "windsurf", "vscode", "chatgpt"].every((id) => ids.includes(id)), ids.join(", "));
  check("Claude Code snippet uses the stable command", getClient("claude-code")!.snippet().includes(INSTALL_STR));
  check("Claude Desktop snippet is valid JSON with mcpServers.octo", (() => { try { return JSON.parse(getClient("claude-desktop")!.snippet()).mcpServers.octo.command === "npx"; } catch { return false; } })());
  check("ChatGPT is manual + flagged as needing a hosted endpoint", getClient("chatgpt")!.kind === "manual" && /hosted|HTTPS/i.test(getClient("chatgpt")!.snippet()));
  check("detects ≥1 client on this machine", detectedClients().length >= 1, detectedClients().map((c) => c.label).join(", ") || "none");

  // generalized JSON writer (configKey-aware), against a temp file
  const tmp = join(tmpdir(), `octo-connect-${process.pid}.json`);
  try {
    const entry = getClient("cursor")!.entry!();
    const r1 = upsertServerEntry(tmp, "mcpServers", "octo", entry);
    const cfg1 = JSON.parse(readFileSync(tmp, "utf8"));
    check("creates a config with a valid octo entry under mcpServers", r1.created && cfg1.mcpServers.octo.command === "npx" && Array.isArray(cfg1.mcpServers.octo.args));

    writeFileSync(tmp, JSON.stringify({ mcpServers: { existing: { command: "x", args: [] } }, keep: true }, null, 2));
    const r2 = upsertServerEntry(tmp, "mcpServers", "octo", entry);
    const cfg2 = JSON.parse(readFileSync(tmp, "utf8"));
    check("backs up + preserves existing server & keys", r2.backedUp && existsSync(tmp + ".bak") && !!cfg2.mcpServers.existing && cfg2.keep === true && !!cfg2.mcpServers.octo);

    const before = readFileSync(tmp, "utf8");
    upsertServerEntry(tmp, "mcpServers", "octo", entry);
    check("re-writing is idempotent", readFileSync(tmp, "utf8") === before);

    // a different configKey (e.g. VS Code's "servers") also works
    const r3 = upsertServerEntry(tmp, "servers", "octo", { type: "stdio", ...entry });
    check("supports an alternate configKey (servers)", r3.backedUp && JSON.parse(readFileSync(tmp, "utf8")).servers.octo.type === "stdio");
  } finally {
    rmSync(tmp, { force: true });
    rmSync(tmp + ".bak", { force: true });
  }

  // --print emits config for every client
  const { io, text } = bufferIO([]);
  await runConnect(io, { print: true });
  const out = text();
  check("`connect --print` lists every client", ["Claude Desktop", "Cursor", "Windsurf", "VS Code", "ChatGPT"].every((l) => out.includes(l)));
  check("`connect --print` includes the stdio bin command", out.includes("octo-mcp-server-stdio"));

  // server handshake (ISC-10)
  check("verifies the server starts + answers initialize", (await verifyServer()) === 9);

  console.log(`\n${failures === 0 ? "✅ CONNECT SMOKE PASSED" : "❌ " + failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
