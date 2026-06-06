/**
 * Server assembly: build the supplier fleet + session, register tools/resources/prompts.
 *
 * Swap createMockAdapters() for HttpOctoAdapter instances (or mix them) to front real
 * OCTO endpoints — the rest of the server is unchanged. That's the "one server, many
 * suppliers" payoff in code.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupplierRegistry } from "./registry.js";
import { CartSession } from "./session.js";
import { createMockAdapters } from "./octo/mockAdapter.js";
import { registerTools, type ToolCtx } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export function createServer(): McpServer {
  const registry = new SupplierRegistry(createMockAdapters());
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
