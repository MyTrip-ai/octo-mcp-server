/**
 * Server assembly: build the supplier fleet + session, register tools/resources/prompts.
 *
 * The fleet (fleet.ts) decides which suppliers sit behind it — mocks, a Ventrata test
 * supplier, or an operator's own OCTO account. The rest of the server is unchanged.
 * That's the "one server, many suppliers" payoff in code.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupplierRegistry } from "./registry.js";
import { CartSession } from "./session.js";
import { loadEnv } from "./config.js";
import { buildAdapters } from "./fleet.js";
import { registerTools, type ToolCtx } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export function createServer(): McpServer {
  loadEnv();
  // Operator mode (OCTO_SYSTEM) fronts only their own account; demo mode fronts the
  // mocks + optional Ventrata test supplier. See fleet.ts.
  const registry = new SupplierRegistry(buildAdapters());
  const session = new CartSession();
  const ctx: ToolCtx = { registry, session };

  const server = new McpServer(
    { name: "octo-mcp-server", version: "0.1.0" },
    {
      instructions:
        "Booking gateway for OCTO suppliers (tours, activities & attractions). " +
        "Discover with search_products → get_product_details → check_availability (returns slot handles). " +
        "Reserve with create_hold (returns a booking ref; does not charge). " +
        "Confirm with confirm_booking ONLY after a human approves the charge (humanApproved=true). " +
        "Prices shown are already final and human-readable; never invent IDs — use the handles the tools return.",
    },
  );

  registerTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server);
  return server;
}
