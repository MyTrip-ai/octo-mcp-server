/**
 * Non-interactive smoke for `demo` mode — runs the narrated auto-play with a
 * no-op advance and asserts the story beats + real MCP calls. (ISC-11)
 *
 * Run: npm run demo-smoke      (SHOW=1 npm run demo-smoke to print the transcript)
 */

import { fileURLToPath } from "node:url";
import { connectMcp, ChatEngine } from "../src/chat/engine.js";
import { glass, setColor } from "../src/cli/ui.js";
import { runDemo } from "../src/cli/demo.js";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  setColor(false);
  const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const conn = await connectMcp(SERVER, "demo-smoke");
  const ls = await conn.callTool("list_suppliers", {});
  const supplierCount = parseInt((ls.match(/fronts (\d+)/) ?? [])[1] ?? "1", 10);

  const lines: string[] = [];
  const out = (s = "") => lines.push(s);
  const calls: string[] = [];
  const engine = new ChatEngine({ callTool: conn.callTool, toolList: conn.toolList, onToolCall: (n) => { calls.push(n); out(glass(n)); } });

  await runDemo({ out, advance: async () => {}, engine, supplierCount });
  const t = lines.join("\n");
  const norm = t.replace(/[^\p{L}\p{N}]+/gu, " ");
  if (process.env.SHOW) console.log(t);

  check("opens with the pitch slide", /THE PITCH/.test(t));
  check("renders product results", /Bartolomé|Snorkel|Tortoise/.test(t));
  check("glass-box shows tool calls", /🔌 search_products/.test(t));
  check("fires the multi-supplier callout", /one server every supplier/i.test(norm));
  check("states the approval-gate line", /cannot charge a cent without an explicit human yes/i.test(norm));
  check("holds then confirms", /On hold/.test(t) && /✓ Confirmed/.test(t));
  check("closes with the OCTO recap + aha", /WHAT THIS MEANS FOR OCTO/.test(t) && /THAT'S THE AHA/.test(t));
  check("made the real MCP calls", ["search_products", "check_availability", "create_hold", "confirm_booking"].every((x) => calls.includes(x)), calls.join(","));

  console.log(`\n${failures === 0 ? "✅ DEMO SMOKE PASSED" : "❌ " + failures + " CHECK(S) FAILED"}`);
  await conn.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
