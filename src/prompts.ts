/**
 * Prompts — pre-built workflows the user can invoke from the client.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "plan-and-book-experience",
    {
      title: "Plan and book an experience",
      description: "Guided flow: discover a tour, check availability, hold, and confirm — with a human approving the charge.",
      argsSchema: {
        destination: z.string().optional().describe("Where, e.g. 'Galápagos' or 'Reykjavík'."),
        dates: z.string().optional().describe("When, e.g. '2026-07-04' or 'first week of July'."),
        party: z.string().optional().describe("Who, e.g. '2 adults, 1 child'."),
      },
    },
    ({ destination, dates, party }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Help me book an experience.\n` +
              `- Destination: ${destination ?? "(ask me)"}\n` +
              `- Dates: ${dates ?? "(ask me)"}\n` +
              `- Party: ${party ?? "(ask me)"}\n\n` +
              `Use search_products to find options, get_product_details for the best fit, then ` +
              `check_availability for my dates. Show me the choices and prices. When I pick one, ` +
              `create_hold it — then STOP and show me the total and details. Only call confirm_booking ` +
              `(with humanApproved=true) after I explicitly approve the charge.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "explain-octo-booking-flow",
    {
      title: "Explain the OCTO booking flow",
      description: "Explain how OCTO reserve-then-confirm works, grounded in the served spec resources.",
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Read the resources octo://spec/booking-lifecycle and octo://spec/pricing, then explain the OCTO ` +
              `reserve-then-confirm flow and money model to me in plain language, noting where a hold can expire.`,
          },
        },
      ],
    }),
  );
}
