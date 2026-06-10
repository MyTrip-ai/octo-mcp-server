/**
 * `demo` mode — the on-rails narrated pitch.
 *
 * Auto-plays a real booking (genuine MCP tool calls, mock data) wrapped in a story
 * with strategic slides, ending on the OCTO recap. `advance(ms)` is supplied by the
 * caller: interactive = wait for Enter; cast generation = record a timed pause.
 */

import type { ChatEngine } from "../chat/engine.js";
import { bold, dim, faint, terracotta, slide, callout, recap, bookingBox } from "./ui.js";

export interface DemoOpts {
  out: (s?: string) => void;
  advance: (ms?: number) => Promise<void>;
  engine: ChatEngine;
  supplierCount: number;
}

export async function runDemo({ out, advance, engine, supplierCount }: DemoOpts): Promise<void> {
  const sid = "demo";
  const say = (s: string) => out("  " + terracotta(`“${s}”`));

  out(slide("THE PITCH", ["What happens when an AI can actually book — not just chat.", "An unofficial look at the OCTO standard as the rails for AI agents."]));
  await advance(1600);

  out("");
  out("  " + dim("A traveler opens their AI assistant and types:"));
  say("Plan me a day in the Galápagos — I'd love to snorkel.");
  await advance(1800);

  out("");
  out("  " + dim("The agent searches every connected supplier at once…"));
  const r = await engine.respond(sid, "snorkeling in the Galápagos");
  const products = r.products ?? [];
  products.slice(0, 3).forEach((p, i) => out(`    ${terracotta(`${i + 1})`)} ${bold(p.title)}${p.fromPrice ? "  " + faint("from " + p.fromPrice) : ""}  ${faint(p.place)}`));
  await advance(1500);
  out("");
  out(callout(`That one search reached all ${supplierCount} connected OCTO supplier${supplierCount === 1 ? "" : "s"} — one server, every supplier. Add another OCTO supplier and it appears here with zero new code.`));
  await advance(2400);

  const pick = products[0];
  out("");
  say(`The ${pick.title} sounds perfect — is Saturday open?`);
  const ra = await engine.respond(sid, `check availability for ${pick.title} next Saturday`);
  const slots = ra.availability?.slots ?? [];
  slots.forEach((s, i) => out(`    ${terracotta(`${i + 1})`)} ${bold(s.when)}  ${faint(s.prices)}  ${s.scarce ? terracotta(s.vacancy) : dim(s.vacancy)}`));
  await advance(1600);

  out("");
  out("  " + dim("The agent reserves the slot while the traveler decides…"));
  const rh = await engine.respond(sid, `hold ${slots[0].handle} for 2 adults`);
  if (rh.booking) out(bookingBox(rh.booking, false));
  await advance(1900);

  out("");
  out(callout("Here's the line that matters: the AI proposed this booking, but it cannot charge a cent without an explicit human yes. That approval gate is the trust model suppliers will require before letting agents touch inventory."));
  await advance(2600);
  out("");
  out("  " + dim("The traveler reviews the price… and approves."));
  await advance(1400);

  const rc = await engine.respond(sid, "confirm, I approve the charge");
  if (rc.booking) out(bookingBox(rc.booking, true));
  await advance(1900);

  out("");
  out(recap());
  await advance(2800);

  out("");
  out(slide("THAT'S THE AHA", ["One server. Every OCTO supplier. A booking only a human can approve.", "github.com/voyageport/octo-mcp-server  ·  unofficial demo"]));
  await advance(1200);
}
