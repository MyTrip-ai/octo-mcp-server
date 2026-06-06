/**
 * Human-readable projection — what the MODEL sees.
 *
 * Tools never return raw OCTO JSON (opaque IDs, integer money). They return these
 * compact, unambiguous summaries. Money is always pre-formatted (DESIGN PRINCIPLE #3);
 * IDs are replaced by slot/booking handles (DESIGN PRINCIPLE #2).
 */

import { formatMoney } from "./money.js";
import type { Booking, Option, Product, Supplier } from "./octo/types.js";
import type { ResolvedSlot } from "./session.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** "Sat 2026-07-04 08:30" from "2026-07-04T08:30:00". */
export function formatLocalDateTime(local: string): string {
  const [date, time = "00:00:00"] = local.split("T");
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${date} ${time.slice(0, 5)}`;
}

function defaultOption(product: Product): Option {
  return product.options.find((o) => o.default) ?? product.options[0];
}

function fromPrice(product: Product): string | null {
  const opt = defaultOption(product);
  const cheapest = opt.units
    .filter((u) => u.pricing)
    .reduce<{ retail: number; p: NonNullable<Option["units"][number]["pricing"]> } | null>((best, u) => {
      const p = u.pricing!;
      if (!best || p.retail < best.retail) return { retail: p.retail, p };
      return best;
    }, null);
  if (!cheapest) return null;
  return formatMoney(cheapest.p.retail, cheapest.p.currencyPrecision, cheapest.p.currency);
}

export function productCard(supplierId: string, product: Product): string {
  const c = product.content;
  const from = fromPrice(product);
  const lines = [
    `• ${c?.title ?? product.internalName}`,
    `    productId: ${product.id}  ·  supplier: ${supplierId}`,
    `    ${c?.location ?? ""}  ·  ${formatDuration(product.durationMinutes)}` +
      (from ? `  ·  from ${from} pp` : ""),
    `    ${product.instantConfirmation ? "Instant confirmation" : "On-request confirmation"}`,
  ];
  if (c?.shortDescription) lines.push(`    ${c.shortDescription}`);
  return lines.join("\n");
}

export function productDetail(supplierId: string, product: Product): string {
  const c = product.content;
  const opt = defaultOption(product);
  const out: string[] = [];
  out.push(`${c?.title ?? product.internalName}`);
  out.push(`productId: ${product.id}  ·  supplier: ${supplierId}  ·  optionId: ${opt.id}`);
  out.push(`${c?.location ?? ""}  ·  ${formatDuration(product.durationMinutes)}  ·  ${product.availabilityType}`);
  out.push(product.instantConfirmation ? "Instant confirmation" : "On-request confirmation");
  if (c?.shortDescription) out.push("", c.shortDescription);
  if (c?.highlights?.length) {
    out.push("", "Highlights:");
    for (const h of c.highlights) out.push(`  - ${h}`);
  }
  out.push("", `Departure times: ${opt.availabilityLocalStartTimes.join(", ")}`);
  out.push(`Cancellation: ${opt.cancellationCutoff}`);
  out.push(`Party size: ${opt.restrictions.minUnits}–${opt.restrictions.maxUnits ?? "∞"} units`);
  out.push("", "Ticket types (price per person):");
  for (const u of opt.units) {
    const p = u.pricing!;
    const r = u.restrictions;
    const age = r.minAge != null || r.maxAge != null ? ` (age ${r.minAge ?? 0}${r.maxAge != null ? `–${r.maxAge}` : "+"})` : "";
    out.push(`  - ${u.type}${age}: ${formatMoney(p.retail, p.currencyPrecision, p.currency)}`);
  }
  out.push("", `To check availability, call check_availability with productId="${product.id}" and a date.`);
  return out.join("\n");
}

export function slotLine(slot: ResolvedSlot): string {
  const prices = slot.units
    .map((u) => `${u.unitType} ${formatMoney(u.retail, slot.currencyPrecision, slot.currency)}`)
    .join(", ");
  const scarce = slot.vacancies <= 4 ? `  ⚠ only ${slot.vacancies} left` : `  ${slot.vacancies} spaces`;
  return `${slot.handle}  ·  ${formatLocalDateTime(slot.localDateTimeStart)}  ·  ${prices}${scarce}`;
}

export function supplierLine(s: Supplier): string {
  return `• ${s.name}  (id: ${s.id}, currency: ${s.currency}, ${s.timeZone})`;
}

export function bookingSummary(ref: string, booking: Booking): string {
  const out: string[] = [];
  out.push(`Booking ${ref}  ·  status: ${booking.status}`);
  out.push(`When: ${formatLocalDateTime(booking.localDateTimeStart)}`);
  if (booking.pricing) {
    const p = booking.pricing;
    out.push(`Total: ${formatMoney(p.retail, p.currencyPrecision, p.currency)} for ${booking.unitItems.length} ticket(s)`);
    if (p.includedTaxes.length) {
      const taxes = p.includedTaxes.map((t) => `${t.name} ${formatMoney(t.retail, p.currencyPrecision, p.currency)}`).join(", ");
      out.push(`Includes: ${taxes}`);
    }
  }
  if (booking.status === "ON_HOLD" && booking.utcExpiresAt) {
    const mins = Math.round((new Date(booking.utcExpiresAt).getTime() - Date.now()) / 60000);
    out.push(`⏳ Hold expires in ${mins} min (at ${booking.utcExpiresAt}). Confirm before then or capacity is released.`);
  }
  if (booking.status === "CONFIRMED") {
    out.push(`Supplier reference: ${booking.supplierReference}`);
    if (booking.voucher) out.push(`Voucher (${booking.voucher.deliveryFormat}): ${booking.voucher.deliveryValue}`);
    if (booking.contact) out.push(`Lead traveler: ${booking.contact.fullName} <${booking.contact.emailAddress}>`);
  }
  out.push(`Cancellable: ${booking.cancellable ? "yes" : "no"}`);
  return out.join("\n");
}
