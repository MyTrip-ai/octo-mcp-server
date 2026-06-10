#!/usr/bin/env node
/**
 * OCTO MCP Demo — CLI entrypoint.
 *
 *   (no args)  → Guided Concierge (the default experience)
 *   connect    → wire the MCP server into your own AI client   [Phase 3]
 *   demo       → auto-playing narrated pitch                    [Phase 3]
 */

import { fileURLToPath } from "node:url";
import { loadEnv } from "../config.js";
import { connectMcp, ChatEngine } from "../chat/engine.js";
import { readlineIO, glass, faint, bold, dim, terracotta, splash } from "./ui.js";
import { onboard, converse } from "./concierge.js";
import { runConnect, type ConnectOpts } from "./connect.js";
import { runDemo } from "./demo.js";

const SERVER_ENTRY = fileURLToPath(new URL("../index.js", import.meta.url)); // dist/index.js — the MCP server

async function runConcierge(): Promise<void> {
  loadEnv();
  const io = readlineIO();
  try {
    const ob = await onboard(io);
    if (ob.ventrataKey) {
      process.env.VENTRATA_OCTO_API_KEY = ob.ventrataKey;
      process.env.VENTRATA_OCTO_ENDPOINT = process.env.VENTRATA_OCTO_ENDPOINT ?? "https://api.ventrata.com/octo";
    }
    io.out("\n  " + faint("Connecting to the OCTO MCP server…"));
    const conn = await connectMcp(SERVER_ENTRY, "octo-cli");
    const engine = new ChatEngine({
      callTool: conn.callTool,
      toolList: conn.toolList,
      anthropicKey: process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? undefined,
      model: process.env.OCTO_CHAT_MODEL,
      onToolCall: (name) => io.out(glass(name)),
    });
    const ls = await conn.callTool("list_suppliers", {});
    const supplierCount = parseInt((ls.match(/fronts (\d+)/) ?? [])[1] ?? "1", 10);
    await converse(io, engine, { name: ob.name, supplierCount });
    await conn.close();
  } finally {
    io.close();
  }
}

async function runDemoCmd(): Promise<void> {
  loadEnv();
  const io = readlineIO();
  try {
    const conn = await connectMcp(SERVER_ENTRY, "octo-demo");
    const out = (s = "") => io.out(s);
    const engine = new ChatEngine({ callTool: conn.callTool, toolList: conn.toolList, onToolCall: (n) => out(glass(n)) }); // deterministic for reproducibility
    const ls = await conn.callTool("list_suppliers", {});
    const supplierCount = parseInt((ls.match(/fronts (\d+)/) ?? [])[1] ?? "1", 10);
    const advance = async () => { await io.ask(faint("  — press Enter —")); };
    await runDemo({ out, advance, engine, supplierCount });
    await conn.close();
  } finally {
    io.close();
  }
}

async function runConnectCmd(opts: ConnectOpts = {}): Promise<void> {
  const io = readlineIO();
  try { await runConnect(io, opts); } finally { io.close(); }
}

/** Default (no args): a connect-first chooser. */
async function runRoot(): Promise<void> {
  const io = readlineIO();
  let choice = NaN;
  try {
    io.out(splash());
    io.out("  " + dim("Add OCTO booking to your AI — or try it right here."));
    io.out("\n  " + bold("What would you like to do?"));
    io.out(`    ${terracotta("1)")} ${bold("Add OCTO to my AI")}  ${faint("(Claude, Cursor, Windsurf, …) — recommended")}`);
    io.out(`    ${terracotta("2)")} Try the guided demo here`);
    io.out(`    ${terracotta("3)")} Watch the 90-second pitch`);
    choice = parseInt((await io.ask(faint("\n  › "))).trim(), 10);
  } finally { io.close(); }
  if (choice === 2) await runConcierge();
  else if (choice === 3) await runDemoCmd();
  else await runConnectCmd();
}

const die = (e: unknown) => { console.error("\n  Error:", e instanceof Error ? e.message : e); process.exit(1); };
const mode = process.argv[2];
if (mode === "connect") {
  const arg = process.argv[3];
  runConnectCmd(arg === "--print" ? { print: true } : arg ? { target: arg } : {}).catch(die);
} else if (mode === "demo") {
  runDemoCmd().catch(die);
} else if (mode === "try" || mode === "concierge") {
  runConcierge().catch(die);
} else {
  runRoot().catch(die);
}
