/**
 * Embedded OCTO spec summary, served as MCP RESOURCES (DESIGN PRINCIPLE #13).
 *
 * Serving the spec as resources is what turns "AI-improved documentation" from a
 * slide into working tooling: a coding agent can pull `octo://spec/...` into context
 * and build/debug integrations grounded in the real spec instead of guessing.
 *
 * Authoritative source: https://docs.octo.travel
 */

export const SPEC_SECTIONS: Record<string, { title: string; body: string }> = {
  overview: {
    title: "OCTO — Overview",
    body: `OCTO (Open Connectivity for Tours, Activities & Attractions) is a free, open REST API
specification standardizing how booking systems, resellers/OTAs, channel managers and
operators exchange product, availability, pricing and booking data. It replaces N×M
bespoke integrations with one spec ("build once, connect to everyone").

Design: a small mandatory CORE (supplier, products, availability, bookings) plus OPTIONAL
CAPABILITIES negotiated per request via the 'Octo-Capabilities' header.

Data model: Supplier → Product → Option → Unit, backed by Availability.`,
  },
  "booking-lifecycle": {
    title: "OCTO — Booking lifecycle (reserve-then-confirm)",
    body: `Two-phase flow:
1. POST /availability  → returns a valid availabilityId for the chosen product/option/date.
2. POST /bookings      → reservation goes ON_HOLD, holding capacity. Carries a 'uuid'
                         idempotency key and returns 'utcExpiresAt' (the hold deadline).
3. POST /bookings/{uuid}/confirm  with a 'contact' object → CONFIRMED (must beat utcExpiresAt
                         or it EXPIRES and capacity is released). This is the money-moving step.
4. Delivery via deliveryMethods (TICKET/VOUCHER; formats QRCODE, CODE128, PDF_URL, PKPASS_URL).
5. PATCH to amend · /extend to lengthen a hold · /cancel (gated by 'cancellable' + cutoff).

Status enum: ON_HOLD, CONFIRMED, CANCELLED, EXPIRED, REDEEMED, NO_SHOW, PENDING, REJECTED,
REBOOKED, QUOTE.`,
  },
  pricing: {
    title: "OCTO — Pricing capability (octo/pricing)",
    body: `Money is an INTEGER plus currencyPrecision: value = amount / (10 ** currencyPrecision).
e.g. 4500 @ precision 2 = 45.00. Always normalize before showing a human/model.

Price fields: original (list/strike-through), retail (customer pays), net (wholesale cost;
margin = retail − net), currency, currencyPrecision, includedTaxes[].
pricingPer: UNIT (per ticket) or BOOKING (one flat price).
Convention: '...From' fields are indicative display prices; non-suffixed fields on the
availability/booking responses are final.`,
  },
  capabilities: {
    title: "OCTO — Capabilities model",
    body: `Optional capabilities, selected via the 'Octo-Capabilities' header (comma-separated) or
'_capabilities' query param:
  octo/pricing       — static & dynamic pricing on most endpoints
  octo/content       — rich descriptions, images, media
  octo/pickups       — pickup points + time windows
  octo/dropoffs      — return/dropoff locations
  octo/notifications — webhook subscriptions (PRODUCT_UPDATE, AVAILABILITY_UPDATE, BOOKING_UPDATE)
  octo/promotions    — promotional pricing (in development)
Capabilities extend responses backward-compatibly, avoiding version churn.`,
  },
  authentication: {
    title: "OCTO — Authentication & transport",
    body: `Auth: API key as a Bearer token — 'Authorization: Bearer {api_key}'. HTTPS mandatory.
A bad/missing/deactivated token returns 403 Forbidden.
Best practice: one unique API key per reseller↔supplier relationship.
Base URLs/versioning are implementation-specific (each implementer hosts the spec),
e.g. Bókun: https://api.bokun.io/octo/v1 (prod), https://api.bokuntest.com/octo/v1 (test).`,
  },
};
