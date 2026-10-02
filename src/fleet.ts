/**
 * The supplier fleet behind one server — shared by the MCP server and the facade.
 *
 * Two modes:
 *   - Operator mode (OCTO_SYSTEM set): ONLY the operator's own account, so sample
 *     tours never mix into their real inventory. OCTO_INCLUDE_MOCKS=true adds them back.
 *   - Demo mode (default): the mock suppliers, plus the Ventrata test supplier when
 *     VENTRATA_OCTO_* is set.
 */

import type { OctoSupplierAdapter } from "./octo/adapter.js";
import { createMockAdapters } from "./octo/mockAdapter.js";
import { HttpOctoAdapter } from "./octo/httpAdapter.js";
import { getOctoConfig, getVentrataConfig } from "./config.js";

type Env = Record<string, string | undefined>;

export function buildAdapters(env: Env = process.env): OctoSupplierAdapter[] {
  const operator = getOctoConfig(env);
  const includeDemo = !operator || env.OCTO_INCLUDE_MOCKS?.trim().toLowerCase() === "true";

  const adapters: OctoSupplierAdapter[] = [];
  if (operator) adapters.push(new HttpOctoAdapter(operator));
  if (includeDemo) {
    adapters.push(...createMockAdapters());
    const ventrata = getVentrataConfig(env);
    if (ventrata) adapters.push(new HttpOctoAdapter(ventrata));
  }
  return adapters;
}
