/**
 * Operator-own-account test: generic OCTO system config, read-only default for live
 * accounts, and no mock suppliers mixed into an operator's own inventory.
 * No network — fetch is stubbed.
 *
 * Run: npm run operator-smoke
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getOctoConfig } from "../src/config.js";
import { buildAdapters } from "../src/fleet.js";
import { HttpOctoAdapter } from "../src/octo/httpAdapter.js";
import { OctoError } from "../src/octo/adapter.js";
import { createServer } from "../src/server.js";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
}
function throws(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ── fetch stub: records calls, serves a tiny fake OCTO supplier ──────
const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string> });
  const body = url.endsWith("/supplier")
    ? { id: "s1", name: "Andes Day Hikes", timeZone: "America/Guayaquil", contact: {} }
    : url.endsWith("/products")
      ? [{ id: "p1", internalName: "Fuya Fuya hike", options: [{ id: "DEFAULT", default: true, units: [] }] }]
      : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function main(): Promise<void> {
  // ── 1. config parsing ──────────────────────────────────────────────
  check("no OCTO_* env → no operator config", getOctoConfig({}) === null);

  const bokun = getOctoConfig({ OCTO_SYSTEM: "bokun", OCTO_API_KEY: "k1", OCTO_VENDOR_ID: "77" });
  check("bokun preset endpoint", bokun?.baseUrl === "https://api.bokun.io/octo/v1", bokun?.baseUrl);
  check("bokun preset auth header", bokun?.authHeader === "Authentication", bokun?.authHeader);
  check("bokun vendor id carried", bokun?.vendorId === "77");
  check("live account is read-only by default", bokun?.readOnly === true);
  check("supplier id defaults to the system name", bokun?.supplierId === "bokun", bokun?.supplierId);

  const ventrata = getOctoConfig({ OCTO_SYSTEM: "ventrata", OCTO_API_KEY: "k2" });
  check("ventrata preset endpoint", ventrata?.baseUrl === "https://api.ventrata.com/octo", ventrata?.baseUrl);
  check("ventrata uses the standard Authorization header", (ventrata?.authHeader ?? "Authorization") === "Authorization");

  const custom = getOctoConfig({ OCTO_SYSTEM: "peek", OCTO_API_KEY: "k3", OCTO_ENDPOINT: "https://octo.example.com/v1/" });
  check("explicit endpoint works for any system (trailing slash trimmed)", custom?.baseUrl === "https://octo.example.com/v1", custom?.baseUrl);

  const noEndpoint = throws(() => getOctoConfig({ OCTO_SYSTEM: "peek", OCTO_API_KEY: "k3" }));
  check("unknown system without OCTO_ENDPOINT → clear error", !!noEndpoint && /OCTO_ENDPOINT/.test(noEndpoint), noEndpoint ?? "no error");

  const noKey = throws(() => getOctoConfig({ OCTO_SYSTEM: "bokun" }));
  check("system without OCTO_API_KEY → clear error", !!noKey && /OCTO_API_KEY/.test(noKey), noKey ?? "no error");

  const writable = getOctoConfig({ OCTO_SYSTEM: "bokun", OCTO_API_KEY: "k1", OCTO_ALLOW_BOOKINGS: "true" });
  check("OCTO_ALLOW_BOOKINGS=true turns holds on", writable?.readOnly === false);

  // ── 2. fleet: mocks never mixed into an operator's own inventory ──
  const own = buildAdapters({ OCTO_SYSTEM: "bokun", OCTO_API_KEY: "k1" });
  check("operator account → only that supplier, no mocks", own.length === 1 && own[0].supplierId === "bokun", own.map((a) => a.supplierId).join(","));

  const withMocks = buildAdapters({ OCTO_SYSTEM: "bokun", OCTO_API_KEY: "k1", OCTO_INCLUDE_MOCKS: "true" });
  check("OCTO_INCLUDE_MOCKS=true adds the sample suppliers back", withMocks.length === 3, withMocks.map((a) => a.supplierId).join(","));

  const demo = buildAdapters({});
  check("no config → the 2 sample suppliers (demo unchanged)", demo.length === 2);

  const legacy = buildAdapters({ VENTRATA_OCTO_API_KEY: "t", VENTRATA_OCTO_ENDPOINT: "https://api.ventrata.com/octo" });
  check("legacy VENTRATA_* demo key still works alongside the samples", legacy.length === 3 && legacy.some((a) => a.supplierId === "ventrata-edinexplore"));

  // ── 3. read-only is enforced in the adapter, before any network call ──
  const ro = new HttpOctoAdapter({ supplierId: "bokun", baseUrl: "https://x.test", apiKey: "k", readOnly: true });
  const writes: Array<[string, () => Promise<unknown>]> = [
    ["createBooking", () => ro.createBooking({ uuid: "u", productId: "p", optionId: "o", availabilityId: "a", unitItems: [] })],
    ["confirmBooking", () => ro.confirmBooking("u", { contact: {} } as never)],
    ["cancelBooking", () => ro.cancelBooking("u")],
  ];
  for (const [name, op] of writes) {
    const before = calls.length;
    let err: unknown = null;
    try {
      await op();
    } catch (e) {
      err = e;
    }
    check(`read-only blocks ${name}`, err instanceof OctoError && /read-only/i.test((err as Error).message), String((err as Error)?.message));
    check(`read-only ${name} makes no network call`, calls.length === before);
  }

  // ── 4. Bókun header quirk reaches the wire ────────────────────────
  calls.length = 0;
  await new HttpOctoAdapter(getOctoConfig({ OCTO_SYSTEM: "bokun", OCTO_API_KEY: "k1", OCTO_VENDOR_ID: "77" })!).listProducts();
  const h = calls[0]?.headers ?? {};
  check("bokun sends 'Authentication: Bearer <key>/<vendor>'", h["Authentication"] === "Bearer k1/77", JSON.stringify(h));
  check("bokun hits its OCTO products endpoint", calls[0]?.url === "https://api.bokun.io/octo/v1/products", calls[0]?.url);

  // ── 5. through the real MCP surface ───────────────────────────────
  const saved = { ...process.env };
  process.env.OCTO_SYSTEM = "bokun";
  process.env.OCTO_API_KEY = "k1";
  delete process.env.VENTRATA_OCTO_API_KEY;
  delete process.env.VENTRATA_OCTO_ENDPOINT;
  const server = createServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "operator-smoke", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const res = (await client.callTool({ name: "list_suppliers", arguments: {} })) as CallToolResult;
  const sc = res.structuredContent as { suppliers?: Array<{ id: string; name: string }> } | undefined;
  const ids = (sc?.suppliers ?? []).map((s) => s.id);
  check("MCP list_suppliers shows only the operator's own account", ids.length === 1 && ids[0] === "bokun", ids.join(","));
  await client.close();
  process.env = saved;

  globalThis.fetch = realFetch;
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
