# OCTO MCP Server — *unofficial* demo

> ⚠️ **Unofficial · not affiliated with, or endorsed by, OCTO.** An independent demo of
> how AI agents could use the open [OCTO standard](https://octo.travel) for tours,
> activities & attractions. It books against **mock suppliers** (and, optionally, a
> Ventrata *test* supplier). No real bookings, no real charges.

**Give your AI the power to book a tour.** This is a tiny
[Model Context Protocol](https://modelcontextprotocol.io) server. Add it to Claude, Cursor,
Windsurf, or any MCP client and your assistant can discover and book in-destination
experiences across **every connected OCTO supplier through one server** — with a human
approving before anything is charged.

It answers a strategic question for OCTO: *as travelers start asking their AI assistants to
book things, who are the rails between the agent and the supplier?*

---

## ⚡ Add it to your AI (60 seconds)

Everything below uses one stable command — no install, no dead paths:
`npx -y -p github:MyTrip-ai/octo-mcp-server octo-mcp-server-stdio`

**Easiest — a guided wizard that detects your client and configures it for you:**

```bash
npx github:MyTrip-ai/octo-mcp-server connect
```

**Or copy-paste for your client:**

| Client | How |
|--------|-----|
| **Claude Code** | `claude mcp add octo -s user -- npx -y -p github:MyTrip-ai/octo-mcp-server octo-mcp-server-stdio` |
| **Claude Desktop** | Settings → Developer → Edit Config → add the `octo` block below, then fully quit & reopen |
| **Cursor** | add the block below to `~/.cursor/mcp.json` |
| **Windsurf** | add the block below to `~/.codeium/windsurf/mcp_config.json` |
| **VS Code** (Copilot/agent) | Command Palette → “MCP: Add Server” → Command (stdio), or paste into your user `mcp.json` (uses `"servers"` + `"type"`) |
| **ChatGPT** | needs a hosted endpoint — *coming* (see [Roadmap](#roadmap)) |

```json
{
  "mcpServers": {
    "octo": {
      "command": "npx",
      "args": ["-y", "-p", "github:MyTrip-ai/octo-mcp-server", "octo-mcp-server-stdio"]
    }
  }
}
```

> `npx github:MyTrip-ai/octo-mcp-server connect --print` prints the exact config for **every**
> client. First launch fetches + builds (a few seconds); after that it's cached.

**Then tell your AI:**
> *“Use the octo tools to book me a Galápagos snorkel tour for Saturday.”*

It'll discover → check availability → hold, then **stop and ask you to approve** before
confirming. That human-in-the-loop gate is the whole point.

## 🧭 Or try it without installing

```bash
npx github:MyTrip-ai/octo-mcp-server          # a chooser: add-to-AI · guided demo · the pitch
npx github:MyTrip-ai/octo-mcp-server demo     # the 90-second narrated pitch
```

Prefer to read it? **[media/octo-demo.txt](media/octo-demo.txt)** is the transcript, or
`npx asciinema play media/octo-demo.cast`.

## Why this matters for OCTO

1. **A new distribution channel.** When travelers ask their AI to book experiences, OCTO can
   be the rails between agent and supplier.
2. **Build once, reach every supplier.** A single MCP server fronts *all* OCTO suppliers — the
   same standardization that powers today's resellers powers AI agents tomorrow. Add another
   OCTO supplier (Bókun, Ventrata, …) and it appears with **zero new code**.
3. **OCTO can lead this.** A canonical "agent-ready" profile — an `octo/mcp` or
   `octo/ai-content` capability — would let suppliers advertise AI-readiness and put OCTO
   ahead of the curve. *(An open question this demo is meant to start, not settle.)*

## How it works (the design that makes it safe)

Deliberately **not** a 1:1 wrapper of the OCTO REST API — that's a footgun for LLMs. Full
rationale in [`DESIGN.md`](DESIGN.md). The essentials:

- **One server, many suppliers** — every supplier sits behind one adapter (mock or live HTTP).
- **The model never touches opaque IDs** — the OCTO `availabilityId` and idempotency `uuid`
  stay server-side, so an agent can't double-book.
- **Money is human-readable** — OCTO's integer + `currencyPrecision` becomes `"$180.00 USD"`.
- **Human-in-the-loop on spend** — `confirm_booking` refuses without explicit approval.
- **Capabilities + auth negotiated server-side** — the model never manages headers or keys.

## Use live OCTO inventory (optional)

Set a **free Ventrata test key** in a git-ignored `.env` (or the `connect` wizard / Guided
Concierge will offer to take one):

```bash
VENTRATA_OCTO_ENDPOINT=https://api.ventrata.com/octo
VENTRATA_OCTO_API_KEY=your-free-test-key
# optional: ANTHROPIC_API_KEY=...  (upgrades the built-in chat brain to Claude)
```

Get one at <https://dashboard.ventrata.com/octo/signup> (test supplier "EdinExplore").

## Roadmap

- **Remote / hosted transport (Streamable HTTP)** — enables **ChatGPT connectors** and remote
  Claude/Cursor against a hosted URL. *(Next.)*

## Architecture

```
src/
  index.ts          the OCTO MCP server (stdio) — 9 tools, resources, prompts
  octo/             OCTO types + adapter seam (mockAdapter, httpAdapter)
  chat/engine.ts    shared chat engine (deterministic + Claude brains, parsers)
  cli/              the CLI: clients registry · connect · concierge · demo · ui
scripts/            bridge (web chat) + smoke/live/cli/connect/demo tests + make-cast
web/                a browser chat over the same MCP server (npm run bridge)
media/              the recorded demo (.cast + .txt)
```

## Develop & verify

```bash
npm install
npm run connect-smoke  # client registry + config writers + handshake (13 checks)
npm run smoke          # MCP server, mock suppliers (12)
npm run live           # real OCTO round-trip via Ventrata (needs a key)
npm run cli-smoke      # guided flow, end to end
npm run demo-smoke     # narrated pitch
npm run cast           # regenerate media/octo-demo.{cast,txt}
npm run bridge         # browser chat at http://localhost:8787
```

## License

[MIT](LICENSE). A reference artifact for the conversation about AI agents and the OCTO
standard. Again: **unofficial — not affiliated with OCTO.**
