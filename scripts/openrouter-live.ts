/**
 * Live check: DeepSeek on OpenRouter drives the MCP tools against the MOCK suppliers only.
 * Needs OPENROUTER_API_KEY in the environment (never printed). Costs a few cents.
 * Run: OPENROUTER_API_KEY=... npx tsx scripts/openrouter-live.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { ChatEngine } from "../src/chat/engine.js";

async function main(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { console.log("SKIP — no OPENROUTER_API_KEY"); return; }
  for (const k of ["VENTRATA_OCTO_API_KEY", "VENTRATA_OCTO_ENDPOINT", "OCTO_SYSTEM"]) delete process.env[k]; // mocks only
  const server = createServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "openrouter-live", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const { tools } = await client.listTools();
  const used: string[] = [];
  const engine = new ChatEngine({
    toolList: tools,
    openrouterKey: key,
    callTool: async (name, args) => {
      used.push(name);
      const r = await client.callTool({ name, arguments: args });
      return ((r.content ?? []) as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
    },
  });
  const t0 = Date.now();
  const r1 = await engine.respond("live", "Find me snorkeling tours in the Galapagos");
  console.log(`turn 1 (${Date.now() - t0} ms) tools=${used.join(",")}\n${r1.reply.slice(0, 400)}\n`);
  const t1 = Date.now();
  const r2 = await engine.respond("live", "What's available for the first one next Saturday for 2 adults?");
  console.log(`turn 2 (${Date.now() - t1} ms) tools=${used.join(",")}\n${r2.reply.slice(0, 400)}`);
  const ok = used.includes("search_products") && used.includes("check_availability") && r2.reply.length > 0;
  console.log(ok ? "\nLIVE PASS" : "\nLIVE FAIL");
  await client.close();
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
