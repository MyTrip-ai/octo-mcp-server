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
import { readlineIO, glass, faint, bold } from "./ui.js";
import { onboard, converse } from "./concierge.js";

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

function stub(label: string): void {
  const io = readlineIO();
  io.out("\n  " + bold(label) + faint(" — coming in the next build."));
  io.out("  " + faint("For now, run with no arguments for the guided demo."));
  io.close();
}

const mode = process.argv[2];
if (mode === "connect") stub("connect — wire this MCP server into your own AI (Claude / Cursor)");
else if (mode === "demo") stub("demo — an auto-playing narrated pitch");
else runConcierge().catch((e) => { console.error("\n  Error:", e instanceof Error ? e.message : e); process.exit(1); });
