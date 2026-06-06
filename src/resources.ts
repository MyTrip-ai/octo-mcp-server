/**
 * Resources — read-only context the model can pull in (DESIGN PRINCIPLE #13).
 *
 *   octo://suppliers                       — the fronted suppliers
 *   octo://catalog/{supplierId}            — a supplier's product catalog
 *   octo://product/{supplierId}/{productId}— one product's full detail
 *   octo://booking/{bookingRef}            — a live booking's state
 *   octo://spec/{section}                  — the OCTO spec itself, for grounding
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "./tools.js";
import { productDetail, supplierLine, bookingSummary } from "./format.js";
import { SPEC_SECTIONS } from "./spec.js";

export function registerResources(server: McpServer, ctx: ToolCtx): void {
  const { registry, session } = ctx;

  server.registerResource(
    "octo-suppliers",
    "octo://suppliers",
    { title: "OCTO suppliers", description: "Every OCTO supplier this server fronts.", mimeType: "text/plain" },
    async (uri) => {
      const suppliers = await registry.suppliers();
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: suppliers.map(supplierLine).join("\n") }] };
    },
  );

  server.registerResource(
    "octo-catalog",
    new ResourceTemplate("octo://catalog/{supplierId}", {
      list: async () => ({
        resources: registry.ids().map((id) => ({ uri: `octo://catalog/${id}`, name: `Catalog: ${id}`, mimeType: "text/plain" })),
      }),
    }),
    { title: "Supplier catalog", description: "Products offered by one OCTO supplier.", mimeType: "text/plain" },
    async (uri, { supplierId }) => {
      const id = String(supplierId);
      const products = await registry.get(id).listProducts();
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: products.map((p) => productDetail(id, p)).join("\n\n———\n\n") }] };
    },
  );

  server.registerResource(
    "octo-product",
    new ResourceTemplate("octo://product/{supplierId}/{productId}", { list: undefined }),
    { title: "Product detail", description: "Full detail for one OCTO product.", mimeType: "text/plain" },
    async (uri, { supplierId, productId }) => {
      const id = String(supplierId);
      const product = await registry.get(id).getProduct(String(productId));
      const text = product ? productDetail(id, product) : `Product '${productId}' not found for supplier '${id}'.`;
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
    },
  );

  server.registerResource(
    "octo-booking",
    new ResourceTemplate("octo://booking/{bookingRef}", {
      list: async () => ({ resources: session.allBookings().map((b) => ({ uri: `octo://booking/${b.ref}`, name: `Booking ${b.ref}`, mimeType: "text/plain" })) }),
    }),
    { title: "Booking", description: "Current state of a booking created this session.", mimeType: "text/plain" },
    async (uri, { bookingRef }) => {
      const ref = session.getBooking(String(bookingRef));
      let text = `Unknown booking '${bookingRef}'.`;
      if (ref) {
        const b = await registry.get(ref.supplierId).getBooking(ref.uuid);
        if (b) text = bookingSummary(ref.ref, b);
      }
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
    },
  );

  server.registerResource(
    "octo-spec",
    new ResourceTemplate("octo://spec/{section}", {
      list: async () => ({
        resources: Object.entries(SPEC_SECTIONS).map(([key, s]) => ({ uri: `octo://spec/${key}`, name: s.title, mimeType: "text/markdown" })),
      }),
    }),
    { title: "OCTO spec", description: "OCTO specification sections for grounding integrations.", mimeType: "text/markdown" },
    async (uri, { section }) => {
      const key = String(section);
      const s = SPEC_SECTIONS[key];
      const text = s ? `# ${s.title}\n\n${s.body}` : `Unknown spec section '${key}'. Known: ${Object.keys(SPEC_SECTIONS).join(", ")}.`;
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );
}
