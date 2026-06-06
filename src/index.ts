#!/usr/bin/env node
/**
 * Entrypoint — stdio transport (works with Claude Desktop, Claude Code, MCP Inspector).
 *
 * IMPORTANT: stdout is the MCP protocol channel. All logging goes to stderr.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[octo-mcp-server] connected over stdio — fronting mock OCTO suppliers");
}

main().catch((err) => {
  console.error("[octo-mcp-server] fatal:", err);
  process.exit(1);
});
