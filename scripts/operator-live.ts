/**
 * Live own-account check: runs the MCP server in operator mode (OCTO_SYSTEM=ventrata)
 * against Ventrata's real OCTO API, using the Ventrata TEST key from .env.
 * Verifies reads work end to end and that read-only refuses a hold.
 *
 * Run: npm run operator-live   (requires .env with VENTRATA_OCTO_API_KEY)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadEnv } from "../src/config.js";
import { createServer } from "../src/server.js";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  loadEnv();
  if (!process.env.VENTRATA_OCTO_API_KEY) {
    console.log("SKIP — no VENTRATA_OCTO_API_KEY in .env");
    return;
  }
  process.env.OCTO_SYSTEM = "ventrata";
  process.env.OCTO_API_KEY = process.env.VENTRATA_OCTO_API_KEY; // the test key; never printed
  process.env.OCTO_CURRENCY = "GBP";
  delete process.env.OCTO_ALLOW_BOOKINGS;

  const server = createServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "operator-live", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult & { structuredContent?: any };

  const sup = await call("list_suppliers", {});
  const suppliers = sup.structuredContent?.suppliers ?? [];
  check("only the operator's account is listed", suppliers.length === 1 && suppliers[0].id === "ventrata", suppliers.map((s: any) => `${s.id} (${s.name})`).join(", "));

  const found = await call("search_products", { query: "Loch" });
  const products = found.structuredContent?.products ?? [];
  check("real products come back", products.length > 0, `${products.length} products`);
  check("no sample products mixed in", products.every((p: any) => p.supplierId === "ventrata"));

  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  const av = await call("check_availability", { productId: products[0]?.productId, date: d.toISOString().slice(0, 10) });
  const slots = av.structuredContent?.slots ?? [];
  check("live availability comes back", slots.length > 0, `${slots.length} slots for ${products[0]?.title}`);

  const hold = await call("create_hold", { slotHandle: slots[0]?.handle, units: [{ type: "ADULT", quantity: 1 }] });
  const text = (hold.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join(" ");
  check("read-only refuses the hold", hold.isError === true && /read-only/i.test(text), text.slice(0, 120));

  await client.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
