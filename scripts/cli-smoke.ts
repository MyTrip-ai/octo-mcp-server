/**
 * Non-interactive CLI smoke test — drives the Guided Concierge through a full
 * search → availability → hold → approve → confirm flow with scripted answers,
 * asserting the rendered transcript + that real MCP tools fired. (ISC-14)
 *
 * Run: npm run cli-smoke
 */

import { fileURLToPath } from "node:url";
import { connectMcp, ChatEngine } from "../src/chat/engine.js";
import { bufferIO, glass } from "../src/cli/ui.js";
import { converse } from "../src/cli/concierge.js";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  const conn = await connectMcp(SERVER, "cli-smoke");
  const ls = await conn.callTool("list_suppliers", {});
  const supplierCount = parseInt((ls.match(/fronts (\d+)/) ?? [])[1] ?? "1", 10);

  const calls: string[] = [];
  // answers: search(1) · product(1) · date(Enter) · slot(1) · party(Enter) · approve(1) · done(2)
  const { io, text } = bufferIO(["1", "1", "", "1", "", "1", "2"]);
  const engine = new ChatEngine({
    callTool: conn.callTool,
    toolList: conn.toolList,
    onToolCall: (n) => { calls.push(n); io.out(glass(n)); },
  });

  await converse(io, engine, { supplierCount });
  const out = text();
  // callouts word-wrap inside boxes (border chars + newlines mid-phrase); normalize to alnum+space
  const norm = out.replace(/[^\p{L}\p{N}]+/gu, " ");

  check("glass-box shows the search_products tool call", /🔌 search_products/.test(out));
  check("renders product results", /Bartolomé|Snorkel|Tortoise/.test(out));
  check("fires the multi-supplier strategic callout", /one server\s+every supplier/i.test(norm));
  check("reaches availability with priced slots", /[$€£]\d/.test(out));
  check("creates a hold (BK ref + 'On hold')", /On hold/.test(out) && /BK-\d+/.test(out));
  check("shows the approval-gate callout", /cannot spend a cent without your explicit yes/i.test(norm));
  check("confirms after approval", /✓ Confirmed/.test(out));
  check("renders the closing OCTO recap", /WHAT THIS MEANS FOR OCTO/.test(out));
  check("made the real MCP calls", ["search_products", "check_availability", "create_hold", "confirm_booking"].every((t) => calls.includes(t)), calls.join(","));

  console.log(`\n${failures === 0 ? "✅ CLI SMOKE PASSED" : "❌ " + failures + " CHECK(S) FAILED"}`);
  await conn.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
