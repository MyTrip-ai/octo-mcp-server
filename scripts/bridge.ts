/**
 * Chat bridge — connects a browser chat to the OCTO MCP server.
 *
 *   browser  →  HTTP (/api/chat)  →  THIS bridge (a real MCP client)
 *            →  stdio  →  octo-mcp-server  →  OCTO suppliers (mock + live Ventrata)
 *
 * A browser can't speak stdio MCP directly, so this is the thin bridge that does.
 * Two "brains" turn a sentence into MCP tool calls:
 *   • Claude agent loop — auto-enabled when ANTHROPIC_API_KEY is set (.env)
 *   • deterministic intent router — the always-on, no-key fallback
 *
 * Run:  npm run bridge   →  open http://localhost:8787
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadEnv } from "../src/config.js";

loadEnv();
const PORT = Number(process.env.PORT ?? 8787);
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? "";
const MODEL = process.env.OCTO_CHAT_MODEL ?? "claude-sonnet-4-6";
const INDEX_HTML = fileURLToPath(new URL("../web/index.html", import.meta.url));
const SERVER_ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// ───────────────────────── MCP client ─────────────────────────
const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY], env: process.env as Record<string, string> });
const mcp = new Client({ name: "octo-chat-bridge", version: "0.1.0" });
await mcp.connect(transport);
const toolList = (await mcp.listTools()).tools;
console.error(`[bridge] connected to MCP server — ${toolList.length} tools, brain=${ANTHROPIC_KEY ? "Claude (" + MODEL + ")" : "deterministic"}`);

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const r = await mcp.callTool({ name, arguments: args });
  const content = (r.content ?? []) as Array<{ type: string; text?: string }>;
  return content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
}

// ───────────────────────── Claude brain ─────────────────────────
type Msg = { role: "user" | "assistant"; content: unknown };
const histories = new Map<string, Msg[]>();

const SYSTEM = `You are Meridian, a warm, concise concierge for booking tours, activities and attractions through the OCTO standard.
Use the provided tools to search, check availability, hold, and confirm bookings across all connected suppliers.
Always show prices exactly as the tools return them. Reserve a hold before confirming.
NEVER set humanApproved=true on confirm_booking unless the user has, in this conversation, explicitly approved the charge (e.g. "yes, confirm", "I approve"). If they haven't, hold the slot and ask them to approve first.
Keep replies short and friendly; surface the key options and the next step.`;

async function claudeBrain(sessionId: string, message: string): Promise<ChatResult> {
  const history = histories.get(sessionId) ?? [];
  history.push({ role: "user", content: message });
  const tools = toolList.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  let lastTool: { name: string; text: string } | null = null;
  for (let i = 0; i < 8; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, tools, messages: history }),
    });
    const data = (await res.json()) as any;
    if (data.type === "error") throw new Error(data.error?.message ?? "anthropic error");
    history.push({ role: "assistant", content: data.content });
    const toolUses = (data.content as any[]).filter((c) => c.type === "tool_use");
    if (toolUses.length === 0) {
      const text = (data.content as any[]).filter((c) => c.type === "text").map((c) => c.text).join("\n");
      histories.set(sessionId, history);
      return { reply: text, ...(lastTool ? structureFromTool(lastTool.name, lastTool.text) : {}) };
    }
    const results = [];
    for (const tu of toolUses) {
      const out = await callTool(tu.name, tu.input);
      if (["search_products", "check_availability", "create_hold", "confirm_booking", "get_booking"].includes(tu.name)) lastTool = { name: tu.name, text: out };
      results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
    }
    history.push({ role: "user", content: results });
  }
  histories.set(sessionId, history);
  return { reply: "I took several steps but didn't finish — could you rephrase?", ...(lastTool ? structureFromTool(lastTool.name, lastTool.text) : {}) };
}

// ───────────────────────── deterministic brain ─────────────────────────
type State = { products: Array<{ id: string; title: string }>; slots: string[]; lastDate?: string; holdRef?: string };
const states = new Map<string, State>();

function parseDate(msg: string): string {
  const iso = msg.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const d = new Date();
  if (iso) return iso[1];
  if (/tomorrow/i.test(msg)) d.setDate(d.getDate() + 1);
  else if (/next week|in a week/i.test(msg)) d.setDate(d.getDate() + 7);
  else if (/weekend|saturday|sat\b/i.test(msg)) { d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); }
  else if (/two weeks|fortnight/i.test(msg)) d.setDate(d.getDate() + 14);
  else d.setDate(d.getDate() + 10);
  return d.toISOString().slice(0, 10);
}
function parseUnits(msg: string): Array<{ type: string; quantity: number }> {
  const out: Array<{ type: string; quantity: number }> = [];
  for (const [re, type] of [[/(\d+)\s*adult/i, "ADULT"], [/(\d+)\s*child/i, "CHILD"], [/(\d+)\s*senior/i, "SENIOR"]] as const) {
    const m = msg.match(re); if (m) out.push({ type, quantity: Number(m[1]) });
  }
  if (out.length === 0) out.push({ type: "ADULT", quantity: 1 });
  return out;
}
function parseProductIds(text: string): Array<{ id: string; title: string }> {
  const out: Array<{ id: string; title: string }> = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].match(/^•\s*(.+)$/);
    const idm = (lines[i + 1] ?? "").match(/productId:\s*(\S+)/);
    if (t && idm) out.push({ id: idm[1], title: t[1].trim() });
  }
  return out;
}

// ── parse MCP tool TEXT output → structured payloads the UI renders as cards ──
type Card = { title: string; productId: string; supplier: string; place: string; fromPrice: string; instant: boolean; blurb: string };
type ChatResult = { reply: string; kind?: string; products?: Card[]; availability?: { productName: string; date?: string; slots: any[] }; booking?: any };

function parseProductCards(text: string): Card[] {
  const out: Card[] = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n").map((l) => l.trim());
    if (!lines[0]?.startsWith("•")) continue;
    const idline = lines.find((l) => l.startsWith("productId:")) ?? "";
    out.push({
      title: lines[0].replace(/^•\s*/, ""),
      productId: (idline.match(/productId:\s*(\S+)/) ?? [])[1] ?? "",
      supplier: (idline.match(/supplier:\s*(\S+)/) ?? [])[1] ?? "",
      place: (lines[2] ?? "").split("·")[0].trim(),
      fromPrice: (block.match(/from\s+(.+?)\s+pp/) ?? [])[1] ?? "",
      instant: /Instant confirmation/.test(block),
      blurb: lines.slice(3).filter((l) => l && !/^(Instant|On-request)/.test(l)).join(" ").slice(0, 160),
    });
  }
  return out;
}
function parseSlots(text: string) {
  const slots: any[] = [];
  for (const l of text.split("\n")) {
    const m = l.trim().match(/^(slot-\d+)\s+·\s+(.+?)\s+·\s+(.+?)\s{2,}(.+)$/);
    if (m) slots.push({ handle: m[1], when: m[2].trim(), prices: m[3].trim(), vacancy: m[4].trim(), scarce: /only|⚠/.test(m[4]) });
  }
  return slots;
}
function parseBooking(text: string) {
  const g = (re: RegExp) => { const m = text.match(re); return m ? m[1].trim() : ""; };
  const v = text.match(/Voucher\s*\(([^)]+)\):\s*(\S+)/);
  return {
    ref: g(/Booking\s+(\S+)/), status: g(/status:\s*(\S+)/), when: g(/When:\s*(.+)/),
    total: g(/Total:\s*(.+?)(?:\s+for|\n|$)/), expiresMin: g(/expires in\s+(\d+)\s+min/),
    supplierRef: g(/Supplier reference:\s*(.+)/), voucherFormat: v ? v[1] : "", voucherUrl: v ? v[2] : "",
  };
}
function structureFromTool(name: string, text: string): Partial<ChatResult> {
  if (name === "search_products") return { kind: "products", products: parseProductCards(text) };
  if (name === "check_availability") return { kind: "availability", availability: { productName: (text.match(/^(.+?) —/m) ?? [])[1] ?? "", slots: parseSlots(text) } };
  if (["create_hold", "confirm_booking", "get_booking", "cancel_booking"].includes(name)) return { kind: "booking", booking: parseBooking(text) };
  return {};
}

async function deterministicBrain(sessionId: string, message: string): Promise<ChatResult> {
  const st = states.get(sessionId) ?? { products: [], slots: [] };
  states.set(sessionId, st);
  const m = message.toLowerCase();

  // greeting / help
  if (/^(hi|hello|hey|help|what can you|start)/.test(m) || message.trim() === "") {
    return { reply: "Hi — I'm Meridian. Tell me where you'd like to go or what you'd like to do, e.g. \"snorkeling in the Galápagos\" or \"things to do in Iceland\". I can check live availability, hold a slot, and confirm once you approve." };
  }

  // confirm
  if (/\b(confirm|book it|i approve|approve the charge|go ahead|yes,? ?confirm)\b/.test(m) && st.holdRef) {
    const nameEmail = message.match(/as ([A-Za-z ]+?)\s*<?([\w.+-]+@[\w.-]+)>?/i);
    const contact = nameEmail ? { fullName: nameEmail[1].trim(), emailAddress: nameEmail[2] } : { fullName: "Guest Traveler", emailAddress: "guest@example.test" };
    const out = await callTool("confirm_booking", { bookingRef: st.holdRef, fullName: contact.fullName, emailAddress: contact.emailAddress, country: "GB", humanApproved: true });
    st.holdRef = undefined;
    return { reply: nameEmail ? "Confirmed — you're booked! 🎉" : "Confirmed — you're booked! 🎉 (Used a placeholder traveler; say \"confirm as Jane Doe <jane@email.com>\" for real details.)", ...structureFromTool("confirm_booking", out) };
  }

  // hold
  if (/\b(hold|reserve|book)\b/.test(m) && st.slots.length) {
    const slotNum = message.match(/slot[ -]?(\d+)/i);
    const handle = slotNum ? st.slots.find((h) => h === `slot-${slotNum[1]}`) ?? st.slots[Number(slotNum[1]) - 1] : st.slots[0];
    if (!handle) return { reply: "Which slot? Tell me the slot number from the availability list." };
    const out = await callTool("create_hold", { slotHandle: handle, units: parseUnits(message) });
    const ref = out.match(/BK-\d+/); if (ref) st.holdRef = ref[0];
    return { reply: "Held — review the details and approve to confirm. You won't be charged until you do.", ...structureFromTool("create_hold", out) };
  }

  // availability (substring match — "avail" must hit "availability" too)
  const wantsAvail = /(avail|when|date|time|check|tomorrow|tonight|weekend|saturday|sunday|monday|tuesday|wednesday|thursday|friday|next week|\d{4}-\d{2}-\d{2})/i.test(message);
  if (wantsAvail && st.products.length) {
    let prod = st.products.find((p) => m.includes(p.title.toLowerCase().split(" ")[0]) || m.includes(p.title.toLowerCase()));
    const idx = message.match(/\b(?:first|1st|number 1|#?1)\b/i) ? 0 : message.match(/\b(?:second|2nd|#?2)\b/i) ? 1 : null;
    if (!prod && idx !== null) prod = st.products[idx];
    if (!prod) prod = st.products[0];
    const date = parseDate(message);
    st.lastDate = date;
    const out = await callTool("check_availability", { productId: prod.id, date });
    st.slots = [...out.matchAll(/slot-\d+/g)].map((x) => x[0]);
    const av = structureFromTool("check_availability", out);
    if (av.availability) { av.availability.productName = prod.title; av.availability.date = date; }
    const has = !!av.availability && av.availability.slots.length > 0;
    return { reply: has ? `${prod.title} — here's what's open on ${date}:` : `No departures for ${prod.title} on ${date}. Try another date.`, ...av };
  }

  // default: search — strip filler, then expand destination synonyms to tokens
  // that actually appear in product titles/locations (the supplier data, not slang).
  const stop = new Set(["i", "want", "to", "a", "the", "for", "me", "show", "find", "some", "in", "on", "near", "tours", "things", "do", "go", "trip", "trips", "book", "looking", "day", "days", "from", "around", "this", "next", "week", "weekend"]);
  const SYN: Record<string, string> = {
    edinburgh: "loch stirling castle scotland", scotland: "loch stirling castle", scottish: "loch stirling castle", highlands: "loch stirling castle",
    iceland: "reykjavik golden northern gullfoss aurora circle", reykjavik: "northern golden gullfoss",
    galapagos: "galápagos bartolomé tortoise snorkel island", "galápagos": "bartolomé tortoise snorkel island lava",
    aurora: "northern lights", snorkeling: "snorkel bartolomé", snorkelling: "snorkel bartolomé", tortoise: "tortoise lava", castle: "stirling castle",
  };
  const words = message.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !stop.has(w));
  const expanded = new Set<string>(words);
  for (const w of words) if (SYN[w]) for (const s of SYN[w].split(" ")) expanded.add(s);
  const query = [...expanded].join(" ") || message;
  const out = await callTool("search_products", { query });
  st.products = parseProductIds(out);
  st.slots = [];
  const cards = parseProductCards(out);
  return {
    reply: cards.length ? `Found ${cards.length} option${cards.length > 1 ? "s" : ""} — tap one to check availability:` : "No matches — try another destination or activity (e.g. \"Iceland\", \"Galápagos\", \"Edinburgh\").",
    kind: "products",
    products: cards,
  };
}

// ───────────────────────── HTTP ─────────────────────────
function cors(res: import("node:http").ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

  if (req.method === "GET" && req.url === "/favicon.ico") { res.writeHead(204).end(); return; }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    try { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(INDEX_HTML)); }
    catch { res.writeHead(500).end("index.html not found"); }
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, brain: ANTHROPIC_KEY ? "claude" : "deterministic", tools: toolList.length }));
    return;
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { sessionId = "default", message = "" } = JSON.parse(body || "{}");
        const result = ANTHROPIC_KEY ? await claudeBrain(sessionId, message) : await deterministicBrain(sessionId, message);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...result, brain: ANTHROPIC_KEY ? "claude" : "deterministic" }));
      } catch (e) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ reply: `Sorry — something went wrong: ${e instanceof Error ? e.message : String(e)}` }));
      }
    });
    return;
  }
  res.writeHead(404).end("not found");
}).listen(PORT, () => console.error(`[bridge] http://localhost:${PORT}  →  open it in your browser`));
