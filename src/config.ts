/**
 * Minimal dependency-free .env loader + live-supplier config.
 *
 * GUI MCP clients (Claude Desktop) don't pass your shell env to the spawned server,
 * so we read the repo's .env ourselves. Values already in process.env win.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HttpOctoConfig } from "./octo/httpAdapter.js";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const envPath = fileURLToPath(new URL("../.env", import.meta.url)); // repo root, from src/ or dist/
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

type Env = Record<string, string | undefined>;

/** Known OCTO systems: endpoint + auth quirks, so an operator only supplies a key. */
const SYSTEM_PRESETS: Record<string, Pick<HttpOctoConfig, "baseUrl" | "authHeader">> = {
  ventrata: { baseUrl: "https://api.ventrata.com/octo" },
  bokun: { baseUrl: "https://api.bokun.io/octo/v1", authHeader: "Authentication" },
};

/**
 * An operator's own OCTO account, from OCTO_* env vars:
 *   OCTO_SYSTEM          ventrata | bokun | any name (then OCTO_ENDPOINT is required)
 *   OCTO_API_KEY         the key issued by the booking system
 *   OCTO_ENDPOINT        optional for presets; overrides the preset endpoint
 *   OCTO_VENDOR_ID       Bókun only: appended to the token
 *   OCTO_CURRENCY        optional, default USD
 *   OCTO_ALLOW_BOOKINGS  "true" to allow holds/bookings; read-only otherwise
 * Returns null when OCTO_SYSTEM is unset; throws a fix-it message when it is set but incomplete.
 */
export function getOctoConfig(env: Env = process.env): HttpOctoConfig | null {
  const system = env.OCTO_SYSTEM?.trim().toLowerCase();
  if (!system) return null;
  const apiKey = env.OCTO_API_KEY?.trim();
  if (!apiKey) throw new Error(`OCTO_SYSTEM=${system} is set but OCTO_API_KEY is missing. Add the API key from your booking system.`);
  const preset = SYSTEM_PRESETS[system];
  const baseUrl = (env.OCTO_ENDPOINT?.trim() || preset?.baseUrl)?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error(
      `No built-in endpoint for OCTO_SYSTEM=${system}. Set OCTO_ENDPOINT to your system's OCTO API URL ` +
        `(built-in: ${Object.keys(SYSTEM_PRESETS).join(", ")}).`,
    );
  }
  return {
    supplierId: system,
    baseUrl,
    apiKey,
    authHeader: preset?.authHeader,
    vendorId: env.OCTO_VENDOR_ID?.trim() || undefined,
    currency: env.OCTO_CURRENCY?.trim() || "USD",
    readOnly: env.OCTO_ALLOW_BOOKINGS?.trim().toLowerCase() !== "true",
  };
}

/** Ventrata live OCTO supplier, if credentials are present. */
export function getVentrataConfig(env: Env = process.env): HttpOctoConfig | null {
  const apiKey = env.VENTRATA_OCTO_API_KEY;
  const baseUrl = env.VENTRATA_OCTO_ENDPOINT;
  if (!apiKey || !baseUrl) return null;
  return {
    supplierId: "ventrata-edinexplore",
    baseUrl,
    apiKey,
    currency: env.VENTRATA_OCTO_CURRENCY ?? "GBP",
    // Ventrata uses the standard Authorization header; Bókun would override this.
  };
}
