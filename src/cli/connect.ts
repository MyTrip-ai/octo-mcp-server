/**
 * `connect` — add the OCTO MCP server to the user's AI client(s). The headline UX.
 *
 * Works across Claude Code, Claude Desktop, Cursor, Windsurf (auto-config) and
 * VS Code / ChatGPT (copy-paste snippet). Every client launches the server with the
 * same stable command (see clients.ts), so installs never point at a dead path.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { sep, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connectMcp } from "../chat/engine.js";
import { IO, bold, dim, faint, teal, terracotta } from "./ui.js";
import { CLIENTS, getClient, type ClientDef } from "./clients.js";

/** Absolute path to the local stdio server (for a fast local verification). */
export function serverEntry(): string {
  const rel = fileURLToPath(new URL("../index.js", import.meta.url));
  if (existsSync(rel)) return rel;
  const dist = rel.replace(`${sep}src${sep}`, `${sep}dist${sep}`);
  return existsSync(dist) ? dist : rel;
}

/** Merge an MCP server entry into a JSON config file under `configKey`, backing up first. */
export function upsertServerEntry(path: string, configKey: string, name: string, entry: object): { created: boolean; backedUp: boolean } {
  const existed = existsSync(path);
  let cfg: any = {};
  if (existed) {
    try { cfg = JSON.parse(readFileSync(path, "utf8") || "{}"); } catch { cfg = {}; }
    copyFileSync(path, path + ".bak");
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }
  cfg[configKey] = cfg[configKey] ?? {};
  cfg[configKey][name] = entry;
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
  return { created: !existed, backedUp: existed };
}

/** Verify the server starts + answers initialize (locally); returns the tool count. */
export async function verifyServer(): Promise<number> {
  const conn = await connectMcp(serverEntry(), "octo-connect-verify");
  const n = conn.toolList.length;
  await conn.close();
  return n;
}

async function choose(io: IO, prompt: string, labels: string[]): Promise<number> {
  io.out("\n  " + bold(prompt));
  labels.forEach((l, i) => io.out(`    ${terracotta(`${i + 1})`)} ${l}`));
  return parseInt((await io.ask(faint("  › "))).trim(), 10) - 1;
}

const SAY = `“Use the octo tools to book me a Galápagos snorkel tour for Saturday.”`;

function printSnippet(io: IO, c: ClientDef): void {
  io.out("\n  " + bold(c.label) + faint("  — " + c.instructions));
  io.out(dim(c.snippet().split("\n").map((l) => "    " + l).join("\n")));
}

async function configure(io: IO, c: ClientDef): Promise<void> {
  if (c.kind === "manual") {
    printSnippet(io, c);
    if (c.id === "chatgpt") io.out("\n  " + faint("(ChatGPT support needs the hosted build — coming next.)"));
    return;
  }
  if (c.kind === "cli") {
    io.out("\n  I'll register it via the " + bold(c.label) + " CLI:");
    io.out(dim("    " + c.snippet()));
    if ((await choose(io, "Proceed?", ["Yes, register it", "No — just show me the command"])) === 0) {
      try { execFileSync(c.cliBin!, c.cliArgs!(), { stdio: "ignore" }); io.out("  " + teal("✓ registered.")); }
      catch (e) { io.out("  " + faint("✗ " + (e instanceof Error ? e.message : String(e)) + " — run the command above manually.")); }
    }
    return;
  }
  // json
  const path = c.configPath!();
  io.out("\n  I'll add an " + bold("'octo'") + " server to:");
  io.out("    " + dim(path));
  if ((await choose(io, "Proceed? (existing config is backed up to .bak first)", ["Yes, write it", "No — just show me the JSON"])) === 0) {
    const r = upsertServerEntry(path, c.configKey!, "octo", c.entry!());
    io.out("  " + teal("✓ written.") + (r.backedUp ? faint(` (backup at ${path}.bak)`) : faint(" (new file)")));
    io.out("  " + faint(c.instructions));
  } else {
    printSnippet(io, c);
  }
}

export interface ConnectOpts { target?: string; print?: boolean }

export async function runConnect(io: IO, opts: ConnectOpts = {}): Promise<void> {
  if (opts.print) {
    io.out("\n  " + bold("Add OCTO to your AI — config for every client") + "\n");
    for (const c of CLIENTS) printSnippet(io, c);
    io.out("\n  " + faint("Stable command used everywhere: ") + dim(CLIENTS[0].snippet().replace("claude mcp add octo -s user -- ", "")));
    return;
  }

  io.out("\n  " + bold(terracotta("Add OCTO to your AI")) + " — give your assistant the power to book.");
  io.out("  " + faint("Your AI gains tools to discover, check availability, hold, and (with your yes) confirm."));

  io.out("\n  " + faint("Verifying the OCTO MCP server…"));
  try { io.out("  " + teal(`✓ server OK — ${await verifyServer()} tools ready.`)); }
  catch (e) { io.out("  " + faint("✗ couldn't start the server: " + (e instanceof Error ? e.message : String(e)))); return; }

  // pick a target
  let client: ClientDef | undefined;
  if (opts.target) {
    client = getClient(opts.target);
    if (!client) { io.out("\n  " + faint(`Unknown client '${opts.target}'. Try one of: ${CLIENTS.map((c) => c.id).join(", ")}.`)); return; }
  } else {
    const labels = CLIENTS.map((c) => `${c.label}${c.detect() ? teal("   ✓ detected") : ""}`);
    const idx = await choose(io, "Which AI client?", [...labels, dim("Show config for ALL clients")]);
    if (idx === CLIENTS.length) { for (const c of CLIENTS) printSnippet(io, c); return; }
    client = CLIENTS[idx];
    if (!client) { io.out("\n  " + faint("No client selected.")); return; }
  }

  await configure(io, client);

  if (client.id !== "chatgpt") {
    io.out("\n  Then, in " + bold(client.label) + ", say:");
    io.out("    " + bold(terracotta(SAY)));
    io.out("  " + faint("It'll discover → check availability → hold, then ask you to approve before confirming."));
  }
}
