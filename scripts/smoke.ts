/**
 * End-to-end smoke test: drives the real MCP surface through an in-memory
 * client↔server pair. Verifies discovery, the slot-handle indirection, the
 * human-approval gate on confirm, and a full confirmed booking.
 *
 * Run: npm run smoke
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../src/server.js";

function textOf(r: unknown): string {
  const res = r as CallToolResult;
  return (res.content ?? []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
}

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  const server = createServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "smoke", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);

  const tools = await client.listTools();
  check("lists 9 tools", tools.tools.length === 9, `${tools.tools.length} tools`);

  const confirmTool = tools.tools.find((t) => t.name === "confirm_booking");
  check("confirm_booking flagged destructive", confirmTool?.annotations?.destructiveHint === true);

  const search = await client.callTool({ name: "search_products", arguments: { query: "Galápagos" } });
  const searchText = textOf(search);
  check("search finds Galápagos products", searchText.includes("gdt-bartolome-snorkel"));
  check("search normalizes money (no raw integers)", searchText.includes("$") && !/\b18000\b/.test(searchText));

  const date = futureDate(14);
  const avail = await client.callTool({ name: "check_availability", arguments: { productId: "gdt-bartolome-snorkel", date } });
  const availText = textOf(avail);
  check("availability returns a slot handle", /slot-\d+/.test(availText), availText.split("\n")[0]);
  const slot = availText.match(/slot-\d+/)?.[0] ?? "slot-1";

  const hold = await client.callTool({ name: "create_hold", arguments: { slotHandle: slot, units: [{ type: "ADULT", quantity: 2 }, { type: "CHILD", quantity: 1 }] } });
  const holdText = textOf(hold);
  check("hold returns a booking ref", /BK-\d+/.test(holdText));
  check("hold shows ON_HOLD + expiry countdown", holdText.includes("ON_HOLD") && holdText.includes("Hold expires"));
  const ref = holdText.match(/BK-\d+/)?.[0] ?? "BK-1";

  // Human-approval gate: must refuse without humanApproved
  const refused = await client.callTool({
    name: "confirm_booking",
    arguments: { bookingRef: ref, fullName: "Ada Traveler", emailAddress: "ada@example.test", country: "US", humanApproved: false },
  });
  check("confirm REFUSED without human approval", (refused as CallToolResult).isError === true, textOf(refused).split("\n")[0]);

  // With approval → confirmed
  const confirmed = await client.callTool({
    name: "confirm_booking",
    arguments: { bookingRef: ref, fullName: "Ada Traveler", emailAddress: "ada@example.test", country: "US", humanApproved: true },
  });
  const confirmedText = textOf(confirmed);
  check("confirm with approval → CONFIRMED", confirmedText.includes("CONFIRMED"));
  check("confirmed booking has supplier reference + voucher", confirmedText.includes("Supplier reference") && confirmedText.includes("Voucher"));

  // Cross-supplier: EUR supplier normalizes to €
  const reAvail = await client.callTool({ name: "check_availability", arguments: { productId: "re-golden-circle", date } });
  check("second supplier (EUR) normalizes to €", textOf(reAvail).includes("€"));

  // Spec resource is served
  const res = await client.readResource({ uri: "octo://spec/booking-lifecycle" });
  check("serves OCTO spec as a resource", String((res.contents?.[0] as { text?: string })?.text ?? "").includes("reserve-then-confirm"));

  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
  await client.close();
  await server.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
