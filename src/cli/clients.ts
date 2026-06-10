/**
 * MCP client registry — one place that knows how to install the OCTO server into
 * each AI client, so `connect` works seamlessly across them.
 *
 * Every client launches the server with the SAME stable, path-independent command:
 *   npx -y -p github:MyTrip-ai/octo-mcp-server octo-mcp-server-stdio
 * (no dead checkout paths; always current). Per-client we only vary the config
 * file location + shape, or the CLI command.
 */

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";

const REPO = "github:MyTrip-ai/octo-mcp-server";
const STDIO_BIN = "octo-mcp-server-stdio";

/** The stable command every client uses to launch the stdio MCP server. */
export const INSTALL = { command: "npx", args: ["-y", "-p", REPO, STDIO_BIN] };
export const INSTALL_STR = `${INSTALL.command} ${INSTALL.args.join(" ")}`;

const home = homedir();
const isWin = platform() === "win32";
const isMac = platform() === "darwin";
const appData = () => process.env.APPDATA ?? join(home, "AppData/Roaming");

function whichSync(bin: string): boolean {
  const dirs = (process.env.PATH ?? "").split(isWin ? ";" : ":");
  return dirs.some((d) => d && (existsSync(join(d, bin)) || existsSync(join(d, `${bin}.cmd`))));
}

function desktopPath(): string {
  if (isMac) return join(home, "Library/Application Support/Claude/claude_desktop_config.json");
  if (isWin) return join(appData(), "Claude/claude_desktop_config.json");
  return join(home, ".config/Claude/claude_desktop_config.json");
}
function vscodeUserMcp(): string {
  if (isMac) return join(home, "Library/Application Support/Code/User/mcp.json");
  if (isWin) return join(appData(), "Code/User/mcp.json");
  return join(home, ".config/Code/User/mcp.json");
}

export type ClientKind = "cli" | "json" | "manual";

export interface ClientDef {
  id: string;
  label: string;
  kind: ClientKind;
  /** Best-effort "is this client installed on this machine?" */
  detect(): boolean;
  // json kind:
  configPath?(): string;
  configKey?: string; // "mcpServers" | "servers"
  entry?(): Record<string, unknown>;
  // cli kind:
  cliBin?: string;
  cliArgs?(): string[];
  /** A copy-paste fallback that works even if auto-config doesn't. */
  snippet(): string;
  instructions: string;
}

const stdioEntry = (): Record<string, unknown> => ({ command: INSTALL.command, args: [...INSTALL.args] });
const jsonSnippet = (key: string, entry: Record<string, unknown>) => JSON.stringify({ [key]: { octo: entry } }, null, 2);

export const CLIENTS: ClientDef[] = [
  {
    id: "claude-code",
    label: "Claude Code (CLI)",
    kind: "cli",
    detect: () => existsSync(join(home, ".claude.json")) || whichSync("claude"),
    cliBin: "claude",
    cliArgs: () => ["mcp", "add", "octo", "-s", "user", "--", INSTALL.command, ...INSTALL.args],
    entry: stdioEntry,
    snippet: () => `claude mcp add octo -s user -- ${INSTALL_STR}`,
    instructions: "Registers at user scope via the Claude Code CLI (works in every project).",
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    kind: "json",
    detect: () => existsSync(dirname(desktopPath())),
    configPath: desktopPath,
    configKey: "mcpServers",
    entry: stdioEntry,
    snippet: () => jsonSnippet("mcpServers", stdioEntry()),
    instructions: "Settings → Developer → Edit Config (or the file directly). Fully quit & reopen Claude Desktop after.",
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "json",
    detect: () => existsSync(join(home, ".cursor")),
    configPath: () => join(home, ".cursor/mcp.json"),
    configKey: "mcpServers",
    entry: stdioEntry,
    snippet: () => jsonSnippet("mcpServers", stdioEntry()),
    instructions: "Writes ~/.cursor/mcp.json. Reload Cursor (or toggle the server in Settings → MCP).",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    kind: "json",
    detect: () => existsSync(join(home, ".codeium/windsurf")) || existsSync(join(home, ".codeium")),
    configPath: () => join(home, ".codeium/windsurf/mcp_config.json"),
    configKey: "mcpServers",
    entry: stdioEntry,
    snippet: () => jsonSnippet("mcpServers", stdioEntry()),
    instructions: "Writes ~/.codeium/windsurf/mcp_config.json. Refresh MCP servers in Windsurf after.",
  },
  {
    id: "vscode",
    label: "VS Code (Copilot / agent mode)",
    kind: "manual",
    detect: () => existsSync(dirname(vscodeUserMcp())) || whichSync("code"),
    snippet: () => JSON.stringify({ servers: { octo: { type: "stdio", command: INSTALL.command, args: [...INSTALL.args] } } }, null, 2),
    instructions: `Command Palette → “MCP: Add Server” → Command (stdio), or paste the snippet into your user mcp.json (${vscodeUserMcp()}). Note: VS Code uses "servers" + a "type" field.`,
  },
  {
    id: "chatgpt",
    label: "ChatGPT (connectors)",
    kind: "manual",
    detect: () => false,
    snippet: () => "ChatGPT connectors require a hosted HTTPS (Streamable-HTTP) MCP endpoint — they don't run a local command.",
    instructions: "Needs the hosted/remote build (Tier 2 — coming). Once hosted, add the URL under Settings → Connectors in ChatGPT (Developer mode).",
  },
];

export function getClient(id: string): ClientDef | undefined {
  return CLIENTS.find((c) => c.id === id);
}
export function detectedClients(): ClientDef[] {
  return CLIENTS.filter((c) => c.detect());
}
