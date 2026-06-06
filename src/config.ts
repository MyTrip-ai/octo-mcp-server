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

/** Ventrata live OCTO supplier, if credentials are present. */
export function getVentrataConfig(): HttpOctoConfig | null {
  const apiKey = process.env.VENTRATA_OCTO_API_KEY;
  const baseUrl = process.env.VENTRATA_OCTO_ENDPOINT;
  if (!apiKey || !baseUrl) return null;
  return {
    supplierId: "ventrata-edinexplore",
    baseUrl,
    apiKey,
    currency: process.env.VENTRATA_OCTO_CURRENCY ?? "GBP",
    // Ventrata uses the standard Authorization header; Bókun would override this.
  };
}
