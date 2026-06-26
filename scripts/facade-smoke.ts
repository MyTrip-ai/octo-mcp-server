/**
 * facade-smoke — end-to-end check of the read-only REST facade (WS-0.1).
 *
 * Spawns the built server (dist/serve.js) on a test port with an OCTO_FACADE_TOKEN
 * and exercises /api/octo/* with and without auth. Proves the facade returns the
 * structured OCTO projections over REST. Uses the zero-credential mock suppliers,
 * so it needs no Ventrata/Anthropic keys.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "smoke-secret";

const serveJs = fileURLToPath(new URL("../dist/serve.js", import.meta.url));
const child = spawn(process.execPath, [serveJs], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", OCTO_FACADE_TOKEN: TOKEN, OCTO_ALLOWED_HOSTS: "" },
  stdio: ["ignore", "ignore", "inherit"],
});

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : ""); }
}

async function waitHealthy(timeoutMs = 15000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error("server did not become healthy");
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main(): Promise<void> {
  await waitHealthy();
  const H = { authorization: `Bearer ${TOKEN}` };

  // 1. unauthenticated → 401
  check("suppliers without token → 401", (await fetch(`${BASE}/api/octo/suppliers`)).status === 401);

  // 2. suppliers
  const sup = await fetch(`${BASE}/api/octo/suppliers`, { headers: H });
  const supBody: any = await sup.json();
  check("suppliers → 200", sup.status === 200, sup.status);
  check("suppliers includes galapagos-day-tours",
    Array.isArray(supBody.suppliers) && supBody.suppliers.some((s: any) => s.id === "galapagos-day-tours"), supBody);

  // 3. search
  const search = await fetch(`${BASE}/api/octo/products?query=snorkel`, { headers: H });
  const searchBody: any = await search.json();
  check("search → 200 with ≥1 product", search.status === 200 && searchBody.count >= 1, searchBody.count);
  const card = (searchBody.products ?? [])[0];
  check("product card: productId + structured fromPrice",
    !!card?.productId && (card.fromPrice === null ||
      (typeof card.fromPrice.amount === "number" && typeof card.fromPrice.currency === "string" && typeof card.fromPrice.currencyPrecision === "number")),
    card);

  // 4. detail
  const det = await fetch(`${BASE}/api/octo/products/gdt-bartolome-snorkel`, { headers: H });
  const detBody: any = await det.json();
  check("detail → 200", det.status === 200, det.status);
  const priced = detBody.product?.unitTypes?.find((u: any) => u.price)?.price;
  check("detail money = integer minor units + precision + display (not a parsed string)",
    !priced || (Number.isInteger(priced.amount) && typeof priced.currencyPrecision === "number" && typeof priced.display === "string"),
    priced);

  // 5. not found → 404
  check("unknown product → 404", (await fetch(`${BASE}/api/octo/products/does-not-exist`, { headers: H })).status === 404);

  // 6. wrong method → 405
  check("POST → 405", (await fetch(`${BASE}/api/octo/suppliers`, { method: "POST", headers: H })).status === 405);
}

main()
  .then(() => { console.log(failures === 0 ? "\nfacade-smoke: PASS" : `\nfacade-smoke: FAIL (${failures})`); child.kill("SIGTERM"); process.exit(failures === 0 ? 0 : 1); })
  .catch((e) => { console.error("facade-smoke error:", e); child.kill("SIGTERM"); process.exit(1); });
