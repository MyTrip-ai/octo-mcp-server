/**
 * Output schemas — OCTO-faithful STRUCTURED results for every tool.
 *
 * MCP hosts (ChatGPT connectors, Claude, …) ask each tool to declare an
 * `outputSchema` so they can render and reason over results without re-parsing
 * prose. When a tool declares one, the SDK validates the `structuredContent` we
 * return against it on every call.
 *
 * These schemas stay true to the OCTO model — integer + `currencyPrecision`
 * money, the OCTO booking/availability status enums, and supplier / product /
 * availability / booking vocabulary — while preserving our two design choices:
 *   1. opaque OCTO IDs (availabilityId, idempotency uuid) stay SERVER-SIDE; the
 *      model sees stable handles (`slot-3`, `BK-1`) instead.
 *   2. every price carries a human-readable `display` alongside the OCTO integer,
 *      so a host can show "$180.00 USD" without doing minor-unit math.
 *
 * Error results are returned with `isError: true` and NO structuredContent — the
 * SDK intentionally skips output validation for those.
 */

import { z } from "zod";
import { formatMoney } from "./money.js";
import type { Booking, Product, Supplier } from "./octo/types.js";
import type { ResolvedSlot } from "./session.js";

// ───────────────────────── shared fragments ─────────────────────────

/** OCTO money: the integer model PLUS a rendered string. */
export const zMoney = z.object({
  amount: z.number().int().describe("Price in MINOR units (OCTO integer money). Real value = amount / 10**currencyPrecision."),
  currency: z.string().describe("ISO 4217 currency code, e.g. 'USD'."),
  currencyPrecision: z.number().int().describe("Decimal places, e.g. 2."),
  display: z.string().describe("Human-readable price, e.g. '$180.00 USD'."),
});

const zSupplier = z.object({
  id: z.string(),
  name: z.string(),
  currency: z.string().describe("Supplier default ISO 4217 currency."),
  timeZone: z.string(),
  locale: z.string().optional(),
  website: z.string().optional(),
  email: z.string().optional(),
});

const zProductCard = z.object({
  productId: z.string().describe("Pass to get_product_details / check_availability."),
  supplierId: z.string(),
  title: z.string(),
  location: z.string().optional(),
  durationMinutes: z.number().int().optional(),
  instantConfirmation: z.boolean(),
  fromPrice: zMoney.nullable().describe("Cheapest per-person price, or null if pricing wasn't returned."),
  shortDescription: z.string().optional(),
});

const zProductDetail = z.object({
  productId: z.string(),
  supplierId: z.string(),
  optionId: z.string().describe("Default option used for pricing/availability."),
  title: z.string(),
  location: z.string().optional(),
  durationMinutes: z.number().int().optional(),
  availabilityType: z.string().describe("OCTO availability type: START_TIME | OPENING_HOURS."),
  instantConfirmation: z.boolean(),
  shortDescription: z.string().optional(),
  highlights: z.array(z.string()),
  departureTimes: z.array(z.string()).describe("Local start times, e.g. ['08:30','13:00']."),
  cancellationCutoff: z.string(),
  partySize: z.object({ min: z.number().int(), max: z.number().int().nullable() }),
  unitTypes: z.array(
    z.object({
      type: z.string().describe("OCTO unit type: ADULT, CHILD, SENIOR, …"),
      price: zMoney.optional().describe("Per-person price for this unit type."),
      minAge: z.number().int().nullable(),
      maxAge: z.number().int().nullable(),
    }),
  ),
});

const zSlot = z.object({
  handle: z.string().describe("Pass to create_hold, e.g. 'slot-3'. (The raw OCTO availabilityId stays server-side.)"),
  startLocal: z.string().describe("Local start datetime, e.g. '2026-07-04T08:30:00'."),
  endLocal: z.string().optional(),
  vacancies: z.number().int().describe("Spaces remaining."),
  prices: z.array(z.object({ unitType: z.string(), price: zMoney })),
});

const zBooking = z.object({
  bookingRef: z.string().describe("Session booking handle, e.g. 'BK-1'. (The OCTO idempotency uuid stays server-side.)"),
  status: z
    .string()
    .describe("OCTO booking status: ON_HOLD | CONFIRMED | CANCELLED | EXPIRED | REDEEMED | NO_SHOW | PENDING | REJECTED | REBOOKED | QUOTE."),
  productId: z.string(),
  productName: z.string().optional(),
  startLocal: z.string().optional(),
  total: zMoney.nullable().describe("Order total, or null if pricing wasn't returned."),
  ticketCount: z.number().int(),
  cancellable: z.boolean(),
  holdExpiresUtc: z.string().nullable().describe("ISO-8601 UTC hold deadline while ON_HOLD, else null."),
  holdExpiresInMinutes: z.number().int().nullable(),
  supplierReference: z.string().nullable().describe("Supplier's own reference, present once CONFIRMED."),
  leadTraveler: z.object({ fullName: z.string(), emailAddress: z.string() }).nullable(),
  voucher: z.object({ deliveryFormat: z.string(), deliveryValue: z.string() }).nullable(),
});

// ───────────────────────── output schema shapes (per tool) ─────────────────────────

export const suppliersOutShape = { suppliers: z.array(zSupplier), count: z.number().int() };
export const productsOutShape = { products: z.array(zProductCard), count: z.number().int(), query: z.string().optional() };
export const productDetailOutShape = { product: zProductDetail };
export const availabilityOutShape = {
  productId: z.string(),
  productName: z.string(),
  optionId: z.string(),
  slots: z.array(zSlot),
  count: z.number().int(),
};
export const holdOutShape = { booking: zBooking, humanApprovalRequired: z.boolean() };
export const bookingOutShape = { booking: zBooking };
export const bookingsListShape = { bookings: z.array(zBooking), count: z.number().int() };

// ───────────────────────── builders (domain → structuredContent) ─────────────────────────

export function moneyOut(retail: number, precision: number, currency: string) {
  return { amount: retail, currency, currencyPrecision: precision, display: formatMoney(retail, precision, currency) };
}

function fromPriceOut(product: Product): ReturnType<typeof moneyOut> | null {
  const opt = product.options.find((o) => o.default) ?? product.options[0];
  let best: { retail: number; precision: number; currency: string } | null = null;
  for (const u of opt.units) {
    const p = u.pricing;
    if (!p) continue;
    if (!best || p.retail < best.retail) best = { retail: p.retail, precision: p.currencyPrecision, currency: p.currency };
  }
  return best ? moneyOut(best.retail, best.precision, best.currency) : null;
}

export function supplierOut(s: Supplier) {
  return { id: s.id, name: s.name, currency: s.currency, timeZone: s.timeZone, locale: s.locale, website: s.contact?.website, email: s.contact?.email };
}

export function productCardOut(supplierId: string, p: Product) {
  return {
    productId: p.id,
    supplierId,
    title: p.content?.title ?? p.internalName,
    location: p.content?.location,
    durationMinutes: p.durationMinutes > 0 ? p.durationMinutes : undefined,
    instantConfirmation: p.instantConfirmation,
    fromPrice: fromPriceOut(p),
    shortDescription: p.content?.shortDescription,
  };
}

export function productDetailOut(supplierId: string, p: Product) {
  const opt = p.options.find((o) => o.default) ?? p.options[0];
  return {
    productId: p.id,
    supplierId,
    optionId: opt.id,
    title: p.content?.title ?? p.internalName,
    location: p.content?.location,
    durationMinutes: p.durationMinutes > 0 ? p.durationMinutes : undefined,
    availabilityType: p.availabilityType,
    instantConfirmation: p.instantConfirmation,
    shortDescription: p.content?.shortDescription,
    highlights: p.content?.highlights ?? [],
    departureTimes: opt.availabilityLocalStartTimes,
    cancellationCutoff: opt.cancellationCutoff,
    partySize: { min: opt.restrictions.minUnits, max: opt.restrictions.maxUnits },
    unitTypes: opt.units.map((u) => ({
      type: u.type,
      price: u.pricing ? moneyOut(u.pricing.retail, u.pricing.currencyPrecision, u.pricing.currency) : undefined,
      minAge: u.restrictions.minAge ?? null,
      maxAge: u.restrictions.maxAge ?? null,
    })),
  };
}

export function slotsOut(productId: string, productName: string, optionId: string, slots: ResolvedSlot[]) {
  return {
    productId,
    productName,
    optionId,
    slots: slots.map((s) => ({
      handle: s.handle,
      startLocal: s.localDateTimeStart,
      endLocal: s.localDateTimeEnd,
      vacancies: s.vacancies,
      prices: s.units.map((u) => ({ unitType: u.unitType, price: moneyOut(u.retail, s.currencyPrecision, s.currency) })),
    })),
    count: slots.length,
  };
}

export function bookingOut(ref: string, b: Booking, productName?: string) {
  const total = b.pricing ? moneyOut(b.pricing.retail, b.pricing.currencyPrecision, b.pricing.currency) : null;
  let mins: number | null = null;
  if (b.status === "ON_HOLD" && b.utcExpiresAt) mins = Math.round((new Date(b.utcExpiresAt).getTime() - Date.now()) / 60000);
  return {
    bookingRef: ref,
    status: b.status,
    productId: b.productId,
    productName,
    startLocal: b.localDateTimeStart,
    total,
    ticketCount: b.unitItems.length,
    cancellable: b.cancellable,
    holdExpiresUtc: b.utcExpiresAt ?? null,
    holdExpiresInMinutes: mins,
    supplierReference: b.supplierReference ?? null,
    leadTraveler: b.contact ? { fullName: b.contact.fullName, emailAddress: b.contact.emailAddress } : null,
    voucher: b.voucher ?? null,
  };
}
