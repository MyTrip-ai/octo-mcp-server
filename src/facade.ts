/**
 * REST facade (read-only) — WS-0.1 of the OCTO↔itinerary integration.
 *
 * The MCP transport is for AI agents; a non-agent backend (the MyTrip itinerary
 * builder's Express middleware) cannot speak MCP/JSON-RPC for a simple data fetch.
 * This adds a thin HTTP/REST surface over the SAME SupplierRegistry + adapters the
 * MCP tools use, returning the SAME validated structured projections (output.ts) —
 * no parallel mapping, no projection drift.
 *
 * Scope (WS-0.1): READ ONLY — suppliers, product search, product detail. The
 * booking lifecycle (availability/hold/confirm) is intentionally NOT exposed here;
 * it stays on the MCP path (Phase 4 / WS-4) because it needs the durable handle
 * store + human-in-the-loop, neither of which belongs in a stateless REST read.
 *
 * Auth: an internal shared bearer token (OCTO_FACADE_TOKEN), for server-to-server
 * calls only (Express → this server, over localhost on the same box). If the token
 * env is unset the facade is DISABLED (503) — it never serves OCTO data unauthed.
 *
 * Money contract: prices are the OCTO structured shape
 *   { amount: <integer MINOR units>, currency, currencyPrecision, display }
 * The caller (Express) converts to major units with amount / 10**currencyPrecision
 * before storing in the itinerary Money model. We do NOT hand back a human string to
 * be re-parsed.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { SupplierRegistry } from "./registry.js";
import { createMockAdapters } from "./octo/mockAdapter.js";
import { HttpOctoAdapter } from "./octo/httpAdapter.js";
import type { OctoSupplierAdapter } from "./octo/adapter.js";
import type { Product } from "./octo/types.js";
import { getVentrataConfig } from "./config.js";
import { supplierOut, productCardOut, productDetailOut } from "./output.js";

const PREFIX = "/api/octo/";

// Lazy singleton registry — reads are stateless, so one shared registry (built
// exactly like server.ts) is correct and avoids per-request adapter construction.
let registry: SupplierRegistry | null = null;
function getRegistry(): SupplierRegistry {
  if (registry) return registry;
  const adapters: OctoSupplierAdapter[] = createMockAdapters();
  const ventrata = getVentrataConfig();
  if (ventrata) adapters.push(new HttpOctoAdapter(ventrata));
  registry = new SupplierRegistry(adapters);
  return registry;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/** Bearer check against OCTO_FACADE_TOKEN. */
function checkAuth(req: IncomingMessage): { configured: boolean; ok: boolean } {
  const token = process.env.OCTO_FACADE_TOKEN;
  if (!token) return { configured: false, ok: false };
  const h = req.headers["authorization"];
  const presented = typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  return { configured: true, ok: presented.length > 0 && presented === token };
}

/**
 * Filter/rank products — mirrors the search_products tool (tools.ts): supplier
 * filter, then token match (any token ≥3 chars), ranked by tokens hit.
 */
function searchProducts(
  items: Array<{ supplierId: string; product: Product }>,
  query: string | undefined,
  supplierId: string | undefined,
): Array<{ supplierId: string; product: Product }> {
  let out = items;
  if (supplierId) out = out.filter((i) => i.supplierId === supplierId);
  if (query) {
    const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3);
    out = out
      .map((it) => {
        const hay = [
          it.product.internalName,
          it.product.content?.title,
          it.product.content?.location,
          it.product.content?.shortDescription,
          ...(it.product.content?.highlights ?? []),
        ]
          .join(" ")
          .toLowerCase();
        const score = tokens.length ? tokens.filter((t) => hay.includes(t)).length : 1;
        return { it, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.it);
  }
  return out;
}

/**
 * Handle a `/api/octo/*` request. Returns true if it owned the request (so the
 * HTTP server can `return`), false if the path isn't ours.
 */
export async function handleOctoFacade(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rawUrl = req.url ?? "";
  if (!rawUrl.startsWith(PREFIX) && rawUrl !== "/api/octo") return false;

  const auth = checkAuth(req);
  if (!auth.configured) {
    json(res, 503, { error: "octo facade not configured (OCTO_FACADE_TOKEN unset)" });
    return true;
  }
  if (!auth.ok) {
    json(res, 401, { error: "unauthorized" });
    return true;
  }
  if (req.method !== "GET") {
    json(res, 405, { error: "method not allowed" });
    return true;
  }

  const url = new URL(rawUrl, "http://localhost");
  const path = url.pathname.replace(/\/+$/, ""); // tolerate trailing slash
  const reg = getRegistry();

  try {
    if (path === "/api/octo/suppliers") {
      const suppliers = await reg.suppliers();
      json(res, 200, { suppliers: suppliers.map(supplierOut), count: suppliers.length });
      return true;
    }

    if (path === "/api/octo/products") {
      const query = url.searchParams.get("query") ?? undefined;
      const supplierId = url.searchParams.get("supplierId") ?? undefined;
      const items = searchProducts(await reg.allProducts(), query, supplierId);
      json(res, 200, {
        products: items.map((i) => productCardOut(i.supplierId, i.product)),
        count: items.length,
        query,
      });
      return true;
    }

    const detail = path.match(/^\/api\/octo\/products\/(.+)$/);
    if (detail) {
      const productId = decodeURIComponent(detail[1]);
      const found = await reg.findProduct(productId);
      if (!found) {
        json(res, 404, { error: `product '${productId}' not found` });
        return true;
      }
      json(res, 200, { product: productDetailOut(found.supplierId, found.product) });
      return true;
    }

    json(res, 404, { error: "not found" });
    return true;
  } catch (e) {
    json(res, 500, { error: "internal error", detail: e instanceof Error ? e.message : String(e) });
    return true;
  }
}
