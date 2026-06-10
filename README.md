# OCTO MCP Server — *unofficial* demo

> ⚠️ **Unofficial · not affiliated with, or endorsed by, OCTO.** This is an
> independent demo exploring how AI agents could use the open
> [OCTO standard](https://octo.travel) for tours, activities & attractions.
> It books against **mock suppliers** (and, optionally, a Ventrata *test* supplier).
> No real bookings, no real charges.

**What happens when an AI can actually _book_ a tour — not just chat about one?**
This is a tiny [Model Context Protocol](https://modelcontextprotocol.io) server that lets
an AI agent discover and book in-destination experiences across **every connected OCTO
supplier through one server** — safely, with a human approving before anything is charged.

It's the working answer to a strategic question for OCTO: *as travelers start asking their
AI assistants to book things, who are the rails between the agent and the supplier?*

---

## ▶ Watch the 20-second demo

```bash
npx asciinema play media/octo-demo.cast
```

Prefer to read it? **[media/octo-demo.txt](media/octo-demo.txt)** is the full transcript.

<!-- To embed an animated player in this README: upload media/octo-demo.cast to
     asciinema.org and paste the badge here, or render a GIF with `agg`. -->

## Try it yourself (zero install)

```bash
npx github:voyageport/octo-mcp-server
```

That launches the **Guided Concierge** — a non-technical, numbers-and-Enter walkthrough:
search → check availability → hold → **approve** → confirm, with the OCTO machinery shown
as it happens. Runs fully offline on bundled demo suppliers; no API key required.

> Requires Node 20+. First run builds automatically.

## Three modes, one server

| Command | Who it's for | What it does |
|---------|--------------|--------------|
| *(none)* | anyone | **Guided Concierge** — the interactive booking walkthrough |
| `connect` | your AI | Wires this MCP server into your **Claude Desktop / Claude Code / Cursor**, then hands off — your assistant gains the booking tools |
| `demo` | a room | An on-rails narrated **pitch** that auto-plays the whole story |

```bash
npx github:voyageport/octo-mcp-server connect   # give your own AI booking superpowers
npx github:voyageport/octo-mcp-server demo       # the narrated pitch
```

## Why this matters for OCTO

1. **A new distribution channel.** When travelers ask their AI to book experiences, OCTO can
   be the rails between agent and supplier.
2. **Build once, reach every supplier.** A single MCP server fronts *all* OCTO suppliers —
   the same standardization that powers today's resellers powers AI agents tomorrow. Add
   another OCTO supplier (Bókun, Ventrata, …) and it appears with **zero new code**.
3. **OCTO can lead this.** A canonical "agent-ready" profile — an `octo/mcp` or
   `octo/ai-content` capability — would let suppliers advertise AI-readiness and put OCTO
   ahead of the curve. *(An open question this demo is meant to start, not settle.)*

## How it works (the design that makes it safe)

This is deliberately **not** a 1:1 wrapper of the OCTO REST API — that's a footgun for LLMs.
See [`DESIGN.md`](DESIGN.md) for the full rationale. The essentials:

- **One server, many suppliers** — every supplier sits behind one `OctoSupplierAdapter`
  (mock or live HTTP). One search reaches them all.
- **The model never touches opaque IDs** — it works with friendly handles; the OCTO
  `availabilityId` and idempotency `uuid` stay server-side, so an agent can't double-book.
- **Money is always human-readable** — OCTO's integer + `currencyPrecision` is normalized to
  `"$180.00 USD"`; raw integers never reach the model.
- **Human-in-the-loop on spend** — `confirm_booking` *refuses* without explicit approval and
  is flagged destructive. The AI proposes; a human disposes.
- **Capabilities + auth negotiated server-side** — the model never manages headers or keys.

## Use live OCTO inventory (optional)

The Guided Concierge's onboarding offers to take a **free Ventrata test key** for live data;
or set it in a git-ignored `.env`:

```bash
VENTRATA_OCTO_ENDPOINT=https://api.ventrata.com/octo
VENTRATA_OCTO_API_KEY=your-free-test-key
# optional: ANTHROPIC_API_KEY=...  (upgrades the chat brain from deterministic to Claude)
```

Get a free key at <https://dashboard.ventrata.com/octo/signup> (test supplier "EdinExplore").

## Architecture

```
src/
  index.ts              the OCTO MCP server (stdio) — 9 tools, resources, prompts
  server.ts             assembles suppliers (mock + optional live Ventrata)
  octo/                 OCTO types + adapter seam (mockAdapter, httpAdapter)
  chat/engine.ts        shared chat engine (deterministic + Claude brains, parsers)
  cli/                  the CLI: ui · concierge · connect · demo
scripts/                bridge (web chat) + smoke/live/cli/connect/demo tests + make-cast
web/                    a browser chat over the same MCP server (npm run bridge)
media/                  the recorded demo (.cast + .txt)
```

## Develop & verify

```bash
npm install
npm run cli            # the Guided Concierge
npm run smoke          # MCP server, mock suppliers (12 checks)
npm run live           # real OCTO round-trip via Ventrata (needs a key)
npm run cli-smoke      # guided flow, end to end
npm run connect-smoke  # config writer + handshake
npm run demo-smoke     # narrated pitch
npm run cast           # regenerate media/octo-demo.{cast,txt}
npm run bridge         # browser chat at http://localhost:8787
```

## License

[MIT](LICENSE). Built as a reference artifact for the conversation about AI agents and the
OCTO standard. Again: **unofficial — not affiliated with OCTO.**
