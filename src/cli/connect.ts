/**
 * `connect` mode — wire this MCP server into the user's own AI client.
 *
 * The authentic MCP "aha": their existing assistant gains a new capability.
 * Detects Claude Desktop / Cursor (JSON config) and Claude Code (CLI), backs up
 * any existing config, writes a valid server entry, verifies the server starts +
 * answers `initialize`, then prints the exact sentence to say to the AI.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connectMcp } from "../chat/engine.js";
import { IO, bold, dim, faint, teal, terracotta } from "./ui.js";

export interface McpClient { id: string; label: string; kind: "json" | "claude-code"; path?: string }

/** Absolute path to the stdio MCP server. Resolves to dist/index.js whether this
 *  module runs compiled (dist/cli) or from source via tsx (src/cli → no src/index.js). */
export function serverEntry(): string {
  const rel = fileURLToPath(new URL("../index.js", import.meta.url));
  if (existsSync(rel)) return rel;
  const dist = rel.replace(`${sep}src${sep}`, `${sep}dist${sep}`);
  return existsSync(dist) ? dist : rel;
}

export function serverConfigEntry(): { command: string; args: string[] } {
  return { command: process.execPath, args: [serverEntry()] };
}

function whichSync(bin: string): boolean {
  const dirs = (process.env.PATH ?? "").split(platform() === "win32" ? ";" : ":");
  return dirs.some((d) => d && existsSync(join(d, bin)));
}

export function detectClients(): McpClient[] {
  const home = homedir();
  const found: McpClient[] = [];

  const desktop =
    platform() === "darwin" ? join(home, "Library/Application Support/Claude/claude_desktop_config.json")
    : platform() === "win32" ? join(process.env.APPDATA ?? join(home, "AppData/Roaming"), "Claude/claude_desktop_config.json")
    : join(home, ".config/Claude/claude_desktop_config.json");
  if (existsSync(dirname(desktop))) found.push({ id: "claude-desktop", label: "Claude Desktop", kind: "json", path: desktop });

  const cursor = join(home, ".cursor/mcp.json");
  if (existsSync(dirname(cursor))) found.push({ id: "cursor", label: "Cursor", kind: "json", path: cursor });

  if (existsSync(join(home, ".claude.json")) || whichSync("claude")) found.push({ id: "claude-code", label: "Claude Code (CLI)", kind: "claude-code" });

  return found;
}

/** Merge an MCP server entry into a JSON config file, backing up any existing file. */
export function upsertServerEntry(path: string, name: string, entry: object): { created: boolean; backedUp: boolean } {
  const existed = existsSync(path);
  let cfg: any = {};
  if (existed) {
    try { cfg = JSON.parse(readFileSync(path, "utf8") || "{}"); } catch { cfg = {}; }
    copyFileSync(path, path + ".bak");
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }
  cfg.mcpServers = cfg.mcpServers ?? {};
  cfg.mcpServers[name] = entry;
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
  return { created: !existed, backedUp: existed };
}

/** Verify the server starts and answers initialize; returns the tool count. */
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

export async function runConnect(io: IO): Promise<void> {
  io.out("\n  " + bold(terracotta("connect")) + " — give your own AI booking superpowers.");
  io.out("  " + faint("This adds the OCTO MCP server to your AI client. Your assistant can then"));
  io.out("  " + faint("discover, check availability, hold, and (with your yes) confirm bookings."));

  const clients = detectClients();
  if (!clients.length) {
    io.out("\n  " + faint("No supported MCP client found (Claude Desktop, Cursor, or Claude Code)."));
    io.out("  " + faint("Install one, then run `connect` again. Or run with no arguments for the guided demo."));
    return;
  }

  const pick = clients.length === 1 ? clients[0] : clients[(await choose(io, "Which AI client should I set up?", clients.map((c) => c.label)))];
  if (!pick) { io.out("\n  " + faint("No client selected.")); return; }

  io.out("\n  " + faint("Verifying the OCTO MCP server starts…"));
  try {
    const n = await verifyServer();
    io.out("  " + teal(`✓ server OK — ${n} tools ready.`));
  } catch (e) {
    io.out("  " + faint("✗ couldn't start the server: " + (e instanceof Error ? e.message : String(e))));
    return;
  }

  if (pick.kind === "claude-code") {
    const args = ["mcp", "add", "octo", "-s", "user", "--", process.execPath, serverEntry()];
    io.out("\n  I'll register it with Claude Code:");
    io.out("    " + dim(`claude ${args.join(" ")}`));
    if ((await choose(io, "Proceed?", ["Yes, register it", "No — just show me the command"])) === 0) {
      try { execFileSync("claude", args, { stdio: "ignore" }); io.out("  " + teal("✓ registered with Claude Code (user scope).")); }
      catch (e) { io.out("  " + faint("✗ " + (e instanceof Error ? e.message : String(e)) + " — you can run the command above manually.")); }
    }
  } else {
    const entry = serverConfigEntry();
    io.out("\n  I'll add an " + bold("'octo'") + " server to:");
    io.out("    " + dim(pick.path!));
    if ((await choose(io, "Proceed? (an existing config is backed up to .bak first)", ["Yes, write it", "No — just show me the JSON"])) === 0) {
      const r = upsertServerEntry(pick.path!, "octo", entry);
      io.out("  " + teal(`✓ written.`) + (r.backedUp ? faint(` (backup at ${pick.path}.bak)`) : faint(" (new file)")));
      io.out("  " + faint("Restart " + pick.label + " so it picks up the new server."));
    } else {
      io.out("\n" + dim(JSON.stringify({ mcpServers: { octo: entry } }, null, 2)));
    }
  }

  io.out("\n  Now open " + bold(pick.label) + " and say:");
  io.out("    " + bold(terracotta("“Use the octo tools to book me a Galápagos snorkel tour for Saturday.”")));
  io.out("  " + faint("It'll discover → check availability → hold, then ask you to approve before confirming."));
  io.out("\n  " + faint("Note: the config points at this checkout. For a permanent setup, clone or `npm i -g` the repo."));
}
