/**
 * Generates media/octo-demo.cast (asciinema v2) from the demo, deterministically —
 * no asciinema binary or screen recording needed. Colored output is forced on.
 *
 * Run: npm run cast    Play: npx asciinema play media/octo-demo.cast
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connectMcp, ChatEngine } from "../src/chat/engine.js";
import { glass, setColor, stripAnsi } from "../src/cli/ui.js";
import { runDemo } from "../src/cli/demo.js";

class CastRecorder {
  events: [number, string, string][] = [];
  t = 0;
  buf = "";
  out(s = ""): void { this.buf += s + "\r\n"; }
  pause(ms = 1400): void { this.commit(); this.t += ms / 1000; }
  commit(): void { if (this.buf) { this.events.push([Number(this.t.toFixed(2)), "o", this.buf]); this.buf = ""; } }
  toCast(width = 98, height = 44): string {
    const header = JSON.stringify({ version: 2, width, height, timestamp: 0, title: "OCTO MCP — unofficial demo", env: { TERM: "xterm-256color" } });
    return [header, ...this.events.map((e) => JSON.stringify(e))].join("\n") + "\n";
  }
}

async function main(): Promise<void> {
  setColor(true);
  const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const conn = await connectMcp(SERVER, "octo-cast");
  const rec = new CastRecorder();
  const out = (s = "") => rec.out(s);
  const engine = new ChatEngine({ callTool: conn.callTool, toolList: conn.toolList, onToolCall: (n) => out(glass(n)) });
  const ls = await conn.callTool("list_suppliers", {});
  const supplierCount = parseInt((ls.match(/fronts (\d+)/) ?? [])[1] ?? "1", 10);

  await runDemo({ out, advance: async (ms = 1400) => rec.pause(ms), engine, supplierCount });
  rec.commit();

  const cast = rec.toCast();
  const path = fileURLToPath(new URL("../media/octo-demo.cast", import.meta.url));
  mkdirSync(fileURLToPath(new URL("../media", import.meta.url)), { recursive: true });
  writeFileSync(path, cast);

  // plain-text transcript (always viewable on GitHub)
  const plain = stripAnsi(rec.events.map((e) => e[2]).join("")).replace(/\r\n/g, "\n");
  writeFileSync(fileURLToPath(new URL("../media/octo-demo.txt", import.meta.url)), plain);

  // validate
  const lines = cast.trim().split("\n");
  const header = JSON.parse(lines[0]);
  const evs = lines.slice(1).map((l) => JSON.parse(l));
  const ok = header.version === 2 && evs.every((e) => Array.isArray(e) && e.length === 3 && e[1] === "o");
  console.log(`wrote media/octo-demo.cast — ${evs.length} events, ~${rec.t.toFixed(1)}s, valid=${ok}`);
  await conn.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
