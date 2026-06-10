/**
 * The Guided Concierge — the default CLI experience.
 *
 * onboard(): splash + plain-language framing + name + data choice (mock vs live key).
 * converse(): the guided booking loop — search → choose → availability → hold →
 *             APPROVAL GATE → confirm → recap, with strategic callouts along the way.
 *
 * It drives the shared ChatEngine with synthesized natural-language messages, so the
 * real MCP tool calls (and the human-approval gate) are exactly the same as the chat.
 */

import type { ChatEngine } from "../chat/engine.js";
import { IO, bold, dim, faint, teal, terracotta, splash, callout, recap, bookingBox } from "./ui.js";

const SUGGESTIONS = ["Snorkeling in the Galápagos", "Things to do in Iceland", "Day trips from Edinburgh"];

export interface OnboardResult { name?: string; ventrataKey?: string }

export async function onboard(io: IO): Promise<OnboardResult> {
  io.out(splash());
  io.out("  " + dim("Behind me is an ") + bold("“MCP server”") + dim(" — the piece that lets an AI actually"));
  io.out("  " + dim("do things, not just talk. Everything I book runs through ") + bold("OCTO") + dim(","));
  io.out("  " + dim("the open standard for tours & activities."));
  await io.ask(faint("\n  Press Enter to begin… "));

  const name = (await io.ask("\n  " + bold("What should I call you?") + faint(" (Enter to skip) "))).trim();

  io.out("\n  " + bold("Pick your data:"));
  io.out("  " + faint("Press Enter to explore with built-in demo suppliers, or paste a free"));
  io.out("  " + faint("Ventrata test key for live inventory."));
  const key = (await io.ask(faint("  › "))).trim();

  return { name: name || undefined, ventrataKey: key || undefined };
}

// ── small prompt helpers (numbers + Enter only — non-technical friendly) ──
async function pickSearch(io: IO): Promise<string> {
  io.out("\n  " + bold("What sounds good?"));
  SUGGESTIONS.forEach((s, i) => io.out(`    ${terracotta(`${i + 1})`)} ${s}`));
  io.out("  " + faint("…or just type what you're looking for."));
  const a = (await io.ask(faint("  › "))).trim();
  const n = parseInt(a, 10);
  if (n >= 1 && n <= SUGGESTIONS.length) return SUGGESTIONS[n - 1];
  return a || SUGGESTIONS[0];
}

/** Returns 0-based index, or -1 to mean "none / search again". */
async function pickFromList(io: IO, prompt: string, labels: string[]): Promise<number> {
  io.out("\n  " + bold(prompt));
  labels.forEach((l, i) => io.out(`    ${terracotta(`${i + 1})`)} ${l}`));
  io.out(`    ${terracotta(`${labels.length + 1})`)} ${dim("Search for something else")}`);
  const a = (await io.ask(faint("  › "))).trim();
  const n = parseInt(a, 10);
  if (n >= 1 && n <= labels.length) return n - 1;
  return -1;
}

async function ask(io: IO, q: string): Promise<string> {
  return (await io.ask("\n  " + bold(q) + "\n" + faint("  › "))).trim();
}

async function choose(io: IO, prompt: string, labels: string[]): Promise<number> {
  io.out("\n  " + bold(prompt));
  labels.forEach((l, i) => io.out(`    ${terracotta(`${i + 1})`)} ${l}`));
  const a = (await io.ask(faint("  › "))).trim();
  return parseInt(a, 10) - 1;
}

export interface ConverseOpts { name?: string; supplierCount: number }

export async function converse(io: IO, engine: ChatEngine, opts: ConverseOpts): Promise<void> {
  const sid = "cli";
  const hi = opts.name ? `, ${opts.name}` : "";
  io.out("\n" + teal(`  Meridian is fronting ${opts.supplierCount} OCTO supplier${opts.supplierCount === 1 ? "" : "s"} behind one server${hi}.`));
  const seen = new Set<string>();

  let again = true;
  while (again) {
    // ── search until we have products ──
    let products: any[] = [];
    while (!products.length) {
      const q = await pickSearch(io);
      io.out("");
      const r = await engine.respond(sid, q);
      io.out("  " + dim(r.reply));
      products = r.products ?? [];
      if (products.length) {
        products.forEach((p, i) =>
          io.out(`    ${terracotta(`${i + 1})`)} ${bold(p.title)}${p.fromPrice ? "  " + faint("from " + p.fromPrice) : ""}` + (p.place ? "\n         " + faint(p.place) : "")),
        );
        if (!seen.has("multi")) {
          seen.add("multi");
          io.out("\n" + callout(`That search reached all ${opts.supplierCount} connected OCTO supplier${opts.supplierCount === 1 ? "" : "s"} at once — one server, every supplier. Connect another OCTO supplier (Bókun, Ventrata, …) and it appears here with zero new code.`));
        }
      } else {
        io.out("  " + faint("Nothing matched — try another destination or activity."));
      }
    }

    // ── choose a product ──
    const pIdx = await pickFromList(io, "Which one shall I check availability for?", products.map((p) => `${p.title}${p.fromPrice ? "  " + faint("from " + p.fromPrice) : ""}`));
    if (pIdx < 0) continue;
    const date = await ask(io, "When? (Enter for next Saturday, or a date like 2026-07-04)");
    io.out("");
    const ra = await engine.respond(sid, `check availability for ${products[pIdx].title} ${date || "next Saturday"}`);
    io.out("  " + dim(ra.reply));
    const slots: any[] = ra.availability?.slots ?? [];
    if (!slots.length) { io.out("  " + faint("No departures then — let's try again.")); continue; }
    slots.forEach((s, i) => io.out(`    ${terracotta(`${i + 1})`)} ${bold(s.when)}  ${faint(s.prices)}  ${s.scarce ? terracotta(s.vacancy) : dim(s.vacancy)}`));

    // ── choose a slot ──
    const sIdx = await pickFromList(io, "Pick a departure to hold:", slots.map((s) => `${s.when}`));
    if (sIdx < 0) continue;
    const party = await ask(io, "How many travelers? (Enter for 2 adults, or e.g. '2 adults 1 child')");
    io.out("");
    const rh = await engine.respond(sid, `hold ${slots[sIdx].handle} for ${party || "2 adults"}`);
    io.out("  " + dim(rh.reply));
    if (rh.booking) io.out(bookingBox(rh.booking, false));

    // ── the approval gate ──
    io.out("\n" + callout("Meridian proposed this booking — but it cannot spend a cent without your explicit yes. That human-in-the-loop approval is exactly the trust model suppliers will demand before letting AI agents touch their inventory."));
    const approve = await choose(io, `Approve and book ${rh.booking?.total ?? "this"}?`, ["Approve & book", "Don't book"]);
    if (approve === 0) {
      io.out("");
      const rc = await engine.respond(sid, "confirm, I approve the charge");
      if (rc.booking) io.out(bookingBox(rc.booking, true));
      io.out("\n" + recap());
    } else {
      io.out("\n  " + faint("No problem — nothing was booked."));
    }

    again = (await choose(io, "Anything else?", ["Find another experience", "I'm done"])) === 0;
  }
  io.out("\n  " + teal("Thanks for exploring Meridian.") + faint(" Run `connect` to plug this into your own AI assistant."));
}
