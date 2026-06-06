/**
 * Live check against the real Ventrata OCTO endpoint (EdinExplore test supplier).
 * Exercises the HttpOctoAdapter directly: supplier → products → availability →
 * hold → confirm → cancel. The demo supplier never charges, so confirm is safe.
 *
 * Run: npm run live   (requires .env with VENTRATA_OCTO_*)
 */

import { randomUUID } from "node:crypto";
import { loadEnv, getVentrataConfig } from "../src/config.js";
import { HttpOctoAdapter } from "../src/octo/httpAdapter.js";
import { formatMoney } from "../src/money.js";

function future(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  loadEnv();
  const cfg = getVentrataConfig();
  if (!cfg) {
    console.log("SKIP — no VENTRATA_OCTO_* credentials in .env");
    return;
  }
  const octo = new HttpOctoAdapter(cfg);

  const supplier = await octo.getSupplier();
  check("getSupplier returns a live supplier", Boolean(supplier.name), supplier.name);

  const products = await octo.listProducts();
  check("listProducts returns real products", products.length > 0, `${products.length} products`);

  // Find a product+option with start times + units, and a bookable slot in the next 2 weeks.
  let picked: { productId: string; optionId: string; unitId: string; slotId: string; productName: string } | null = null;
  for (const p of products) {
    const opt = p.options.find((o) => o.availabilityLocalStartTimes.length && o.units.length);
    if (!opt) continue;
    const avail = await octo.checkAvailability({ productId: p.id, optionId: opt.id, localDateStart: future(7), localDateEnd: future(14) });
    const slot = avail.find((a) => a.available && a.status !== "SOLD_OUT" && (a.unitPricing?.length ?? 0) > 0);
    if (slot) {
      picked = { productId: p.id, optionId: opt.id, unitId: opt.units[0].id, slotId: slot.id, productName: p.content?.title ?? p.internalName };
      const pr = slot.unitPricing![0];
      check("checkAvailability returns a bookable slot w/ real price", true, `${picked.productName} @ ${slot.localDateTimeStart} · ${formatMoney(pr.retail, pr.currencyPrecision, pr.currency)}`);
      break;
    }
  }
  if (!picked) {
    check("found a bookable slot", false, "none in the next 2 weeks");
    console.log(`\n❌ ${failures} CHECK(S) FAILED`);
    process.exit(1);
  }

  const uuid = randomUUID();
  const hold = await octo.createBooking({ uuid, productId: picked.productId, optionId: picked.optionId, availabilityId: picked.slotId, unitItems: [{ unitId: picked.unitId }] });
  check("createBooking → ON_HOLD with real supplier ref", hold.status === "ON_HOLD" && !!hold.supplierReference, `ref ${hold.supplierReference}, expires ${hold.utcExpiresAt}`);

  const confirmed = await octo.confirmBooking(uuid, { contact: { fullName: "Ada Traveler", emailAddress: "ada@example.test", country: "GB" } });
  check("confirmBooking → CONFIRMED (demo, no charge)", confirmed.status === "CONFIRMED", `ref ${confirmed.supplierReference}`);

  const cancelled = await octo.cancelBooking(uuid);
  check("cancelBooking → CANCELLED (cleanup)", cancelled.status === "CANCELLED");

  console.log(`\n${failures === 0 ? "✅ LIVE CHECK PASSED — real OCTO round-trip via Ventrata" : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
