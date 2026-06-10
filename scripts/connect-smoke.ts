/**
 * Non-interactive smoke for `connect` mode (ISC-9, ISC-10) — exercises the pure
 * config-writer + server verification against a TEMP file. Never touches real
 * client configs.
 *
 * Run: npm run connect-smoke
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectClients, upsertServerEntry, verifyServer, serverConfigEntry } from "../src/cli/connect.js";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  // detection
  const clients = detectClients();
  check("detects ≥1 MCP client on this machine", clients.length >= 1, clients.map((c) => c.label).join(", ") || "none");

  const tmp = join(tmpdir(), `octo-connect-${process.pid}.json`);
  try {
    // 1) new file → creates, valid entry
    const entry = serverConfigEntry();
    const r1 = upsertServerEntry(tmp, "octo", entry);
    const cfg1 = JSON.parse(readFileSync(tmp, "utf8"));
    check("creates a new config with a valid octo entry", r1.created && !!cfg1.mcpServers?.octo?.command && Array.isArray(cfg1.mcpServers.octo.args));
    check("entry points at the stdio server (dist/index.js)", /dist\/index\.js$/.test(cfg1.mcpServers.octo.args[0]));

    // 2) pre-existing config with another server → backs up + preserves + merges
    writeFileSync(tmp, JSON.stringify({ mcpServers: { existing: { command: "x", args: [] } }, other: true }, null, 2));
    const r2 = upsertServerEntry(tmp, "octo", entry);
    const cfg2 = JSON.parse(readFileSync(tmp, "utf8"));
    check("backs up an existing config to .bak", r2.backedUp && existsSync(tmp + ".bak"));
    check("preserves the unrelated existing server + keys", !!cfg2.mcpServers.existing && cfg2.other === true);
    check("adds octo alongside without clobbering", !!cfg2.mcpServers.octo && !!cfg2.mcpServers.existing);

    // 3) idempotent re-write
    const before = readFileSync(tmp, "utf8");
    upsertServerEntry(tmp, "octo", entry);
    check("re-writing is idempotent", readFileSync(tmp, "utf8") === before);

    // verify server handshake (ISC-10)
    const tools = await verifyServer();
    check("verifies the server starts + answers initialize", tools === 9, `${tools} tools`);
  } finally {
    rmSync(tmp, { force: true });
    rmSync(tmp + ".bak", { force: true });
  }

  console.log(`\n${failures === 0 ? "✅ CONNECT SMOKE PASSED" : "❌ " + failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
