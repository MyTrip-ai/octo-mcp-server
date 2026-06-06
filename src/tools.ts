/**
 * Tools — intent-level, NOT a 1:1 REST mirror (DESIGN PRINCIPLE #1).
 *
 * The model expresses goals ("find Galápagos tours", "hold slot-3 for 2 adults",
 * "confirm BK-1"); the server does the OCTO orchestration, owns the opaque IDs and
 * idempotency uuid, normalizes money, and gates the money-moving steps behind an
 * explicit human approval (DESIGN PRINCIPLE #5).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OctoError } from "./octo/adapter.js";
import type { SupplierRegistry } from "./registry.js";
import type { CartSession } from "./session.js";
import {
  bookingSummary,
  productCard,
  productDetail,
  slotLine,
  supplierLine,
} from "./format.js";

export interface ToolCtx {
  registry: SupplierRegistry;
  session: CartSession;
}

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}
function errText(message: string, suggestion?: string): CallToolResult {
  return { content: [{ type: "text", text: suggestion ? `${message}\n→ ${suggestion}` : message }], isError: true };
}
/** Wrap a handler so OctoError becomes a clean, model-actionable message. */
function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  return fn().catch((e) => {
    if (e instanceof OctoError) return errText(e.message, e.suggestion);
    return errText(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  });
}

export function registerTools(server: McpServer, ctx: ToolCtx): void {
  const { registry, session } = ctx;

  // ─────────────────────────── Discovery (read-only) ───────────────────────────

  server.registerTool(
    "list_suppliers",
    {
      title: "List OCTO suppliers",
      description: "List every OCTO supplier this server fronts. One server can front many suppliers because they all speak the OCTO spec.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      guard(async () => {
        const suppliers = await registry.suppliers();
        return text(`This server fronts ${suppliers.length} OCTO supplier(s):\n\n${suppliers.map(supplierLine).join("\n")}`);
      }),
  );

  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description: "Search/browse experiences across all OCTO suppliers. Returns human-readable cards with a from-price. Optionally filter by free-text query or supplierId.",
      inputSchema: {
        query: z.string().optional().describe("Free text, matched against title/location/description, e.g. 'Galápagos snorkel'."),
        supplierId: z.string().optional().describe("Restrict to one supplier (see list_suppliers)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, supplierId }) =>
      guard(async () => {
        let items = await registry.allProducts();
        if (supplierId) items = items.filter((i) => i.supplierId === supplierId);
        if (query) {
          const q = query.toLowerCase();
          items = items.filter(({ product: p }) => {
            const hay = [p.internalName, p.content?.title, p.content?.location, p.content?.shortDescription, ...(p.content?.highlights ?? [])]
              .join(" ")
              .toLowerCase();
            return hay.includes(q);
          });
        }
        if (items.length === 0) return text("No matching products. Try a broader query or call list_suppliers.");
        return text(`Found ${items.length} product(s):\n\n${items.map((i) => productCard(i.supplierId, i.product)).join("\n\n")}`);
      }),
  );

  server.registerTool(
    "get_product_details",
    {
      title: "Get product details",
      description: "Full detail for one product: description, highlights, departure times, ticket types with per-person prices, and cancellation policy.",
      inputSchema: { productId: z.string().describe("From search_products, e.g. 'gdt-bartolome-snorkel'.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ productId }) =>
      guard(async () => {
        const found = await registry.findProduct(productId);
        if (!found) return errText(`Product '${productId}' not found.`, "Call search_products to find a valid productId.");
        return text(productDetail(found.supplierId, found.product));
      }),
  );

  server.registerTool(
    "check_availability",
    {
      title: "Check availability",
      description:
        "Check bookable departures for a product on a date (or date range, YYYY-MM-DD). Returns slots with prices and spaces left. Each slot gets a handle like 'slot-3' — use that handle to create a hold. (You never handle raw availability IDs.)",
      inputSchema: {
        productId: z.string().describe("From search_products."),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date, YYYY-MM-DD."),
        dateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Optional inclusive end date for a range (max 14 days)."),
        optionId: z.string().optional().describe("Defaults to the product's default option."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ productId, date, dateEnd, optionId }) =>
      guard(async () => {
        const found = await registry.findProduct(productId);
        if (!found) return errText(`Product '${productId}' not found.`, "Call search_products first.");
        const { supplierId, product } = found;
        const option = optionId ? product.options.find((o) => o.id === optionId) : product.options.find((o) => o.default) ?? product.options[0];
        if (!option) return errText(`Option '${optionId}' not found on '${productId}'.`);

        const adapter = registry.get(supplierId);
        const availabilities = await adapter.checkAvailability({ productId, optionId: option.id, localDateStart: date, localDateEnd: dateEnd });
        const bookable = availabilities.filter((a) => a.available && a.status !== "SOLD_OUT");
        if (bookable.length === 0) return text(`No availability for '${product.content?.title ?? productId}' in that window. Try other dates.`);

        const slots = bookable.map((a) => {
          const first = a.unitPricing?.[0];
          return session.addSlot({
            supplierId,
            productId,
            productName: product.content?.title ?? product.internalName,
            optionId: option.id,
            availabilityId: a.id,
            localDateTimeStart: a.localDateTimeStart,
            localDateTimeEnd: a.localDateTimeEnd,
            vacancies: a.vacancies,
            currency: first?.currency ?? "USD",
            currencyPrecision: first?.currencyPrecision ?? 2,
            units: (a.unitPricing ?? []).map((p) => ({ unitId: p.unitId, unitType: p.unitType, retail: p.retail })),
          });
        });
        return text(
          `${product.content?.title ?? productId} — ${slots.length} departure(s):\n\n${slots.map(slotLine).join("\n")}\n\n` +
            `To reserve, call create_hold with the slot handle and how many of each ticket type.`,
        );
      }),
  );

  // ─────────────────────────── Booking (mutating) ───────────────────────────

  server.registerTool(
    "create_hold",
    {
      title: "Create hold (reserves inventory)",
      description:
        "Reserve a slot (status ON_HOLD) while you collect traveler details. The server generates the OCTO idempotency uuid and returns a booking ref like 'BK-1' plus a hold-expiry countdown. This does NOT charge anyone yet — confirm_booking does.",
      inputSchema: {
        slotHandle: z.string().describe("A handle from check_availability, e.g. 'slot-3'."),
        units: z
          .array(z.object({ type: z.string().describe("Ticket type, e.g. ADULT/CHILD/SENIOR"), quantity: z.number().int().positive() }))
          .optional()
          .describe("Ticket mix, e.g. [{type:'ADULT',quantity:2},{type:'CHILD',quantity:1}]. Defaults to 1 ADULT."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ slotHandle, units }) =>
      guard(async () => {
        const slot = session.getSlot(slotHandle);
        if (!slot) return errText(`Unknown slot '${slotHandle}'.`, "Run check_availability to get current slot handles.");

        const requested = units && units.length ? units : [{ type: "ADULT", quantity: 1 }];
        const unitItems: Array<{ unitId: string }> = [];
        for (const r of requested) {
          const match = slot.units.find((u) => u.unitType.toUpperCase() === r.type.toUpperCase());
          if (!match) {
            const avail = slot.units.map((u) => u.unitType).join(", ");
            return errText(`Ticket type '${r.type}' not available for this slot.`, `Available types: ${avail}.`);
          }
          for (let i = 0; i < r.quantity; i++) unitItems.push({ unitId: match.unitId });
        }

        const adapter = registry.get(slot.supplierId);
        const { ref, uuid } = session.newBooking(slot.supplierId);
        const booking = await adapter.createBooking({
          uuid,
          productId: slot.productId,
          optionId: slot.optionId,
          availabilityId: slot.availabilityId,
          unitItems,
        });
        return text(
          `Held ${slot.productName}.\n\n${bookingSummary(ref, booking)}\n\n` +
            `⚠ NEXT STEP — human approval required: confirming will CHARGE the customer. Show the total and details ` +
            `to the human, get explicit approval, then call confirm_booking with bookingRef="${ref}" and humanApproved=true.`,
        );
      }),
  );

  server.registerTool(
    "confirm_booking",
    {
      title: "Confirm booking (charges the customer)",
      description:
        "Confirm a held booking (ON_HOLD → CONFIRMED). THIS CHARGES THE CUSTOMER and is effectively irreversible. You MUST have shown the price/details to a human and gotten explicit approval first; pass humanApproved=true to attest to that. Must happen before the hold expires.",
      inputSchema: {
        bookingRef: z.string().describe("e.g. 'BK-1' from create_hold."),
        fullName: z.string().describe("Lead traveler full name."),
        emailAddress: z.string().email().describe("Lead traveler email."),
        phoneNumber: z.string().optional(),
        country: z.string().optional().describe("ISO country, if the option requires it."),
        humanApproved: z.boolean().describe("Set true ONLY after a human has approved the charge. If false, the server refuses."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ bookingRef, fullName, emailAddress, phoneNumber, country, humanApproved }) =>
      guard(async () => {
        const ref = session.getBooking(bookingRef);
        if (!ref) return errText(`Unknown booking '${bookingRef}'.`, "create_hold returns the booking ref.");
        if (!humanApproved) {
          return errText(
            "Refusing to confirm: this charges the customer and humanApproved is not true.",
            "Present the total and booking details to the human, get explicit approval, then call again with humanApproved=true.",
          );
        }
        const adapter = registry.get(ref.supplierId);
        const booking = await adapter.confirmBooking(ref.uuid, { contact: { fullName, emailAddress, phoneNumber, country } });
        return text(`✅ Confirmed.\n\n${bookingSummary(bookingRef, booking)}`);
      }),
  );

  server.registerTool(
    "cancel_booking",
    {
      title: "Cancel booking",
      description: "Cancel a booking (if cancellable and within the cancellation cutoff). Destructive — requires confirm=true.",
      inputSchema: {
        bookingRef: z.string(),
        confirm: z.boolean().describe("Set true to actually cancel. If false, the server refuses."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ bookingRef, confirm }) =>
      guard(async () => {
        const ref = session.getBooking(bookingRef);
        if (!ref) return errText(`Unknown booking '${bookingRef}'.`);
        if (!confirm) return errText("Refusing to cancel without confirm=true.", "Confirm with the human, then call again with confirm=true.");
        const adapter = registry.get(ref.supplierId);
        const booking = await adapter.cancelBooking(ref.uuid);
        return text(`Cancelled.\n\n${bookingSummary(bookingRef, booking)}`);
      }),
  );

  server.registerTool(
    "get_booking",
    {
      title: "Get booking",
      description: "Fetch the current status and details of one booking by its ref.",
      inputSchema: { bookingRef: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ bookingRef }) =>
      guard(async () => {
        const ref = session.getBooking(bookingRef);
        if (!ref) return errText(`Unknown booking '${bookingRef}'.`);
        const booking = await registry.get(ref.supplierId).getBooking(ref.uuid);
        if (!booking) return errText(`Booking '${bookingRef}' no longer exists.`);
        return text(bookingSummary(bookingRef, booking));
      }),
  );

  server.registerTool(
    "list_bookings",
    {
      title: "List bookings",
      description: "List all bookings created in this session with their current status.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      guard(async () => {
        const refs = session.allBookings();
        if (refs.length === 0) return text("No bookings yet this session.");
        const summaries: string[] = [];
        for (const r of refs) {
          const b = await registry.get(r.supplierId).getBooking(r.uuid);
          if (b) summaries.push(bookingSummary(r.ref, b));
        }
        return text(summaries.join("\n\n"));
      }),
  );
}
