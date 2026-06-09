# OCTO MCP Server (reference demo)

A Model Context Protocol (MCP) server for the **OCTO standard** — the open API
specification for tours, activities & attractions (<https://octo.travel>).

It lets an AI agent **discover and book in-destination experiences** across many
OCTO suppliers through one server — safely. It is the working artifact behind the
proposal that *OCTO is the booking layer for AI agents*.

> Status: runnable demo. Fronts two **mock** OCTO suppliers (zero credentials).
> A stub `HttpOctoAdapter` shows the path to a real OCTO endpoint (e.g. a Bókun test host).

## What it demonstrates (the thesis, in code)

- **One server, many OCTO suppliers** — because every supplier speaks the same spec, a single MCP server fronts all of them (here: a EUR supplier in Iceland + a USD supplier in the Galápagos).
- **Intent-level tools, not a REST mirror** — the model says "find Galápagos tours", "hold slot-3 for 2 adults", "confirm BK-1". The server does the OCTO orchestration.
- **The model never touches opaque IDs** — `check_availability` returns friendly handles (`slot-3`); `create_hold` returns a booking ref (`BK-1`). The OCTO `availabilityId` and idempotency `uuid` stay server-side.
- **Money is always human-readable** — OCTO's integer + `currencyPrecision` is normalized to `"$180.00 USD"` / `"€99.00 EUR"`. Raw integers never reach the model.
- **Human-in-the-loop on the paid step** — `confirm_booking` *refuses* unless `humanApproved=true`; `cancel_booking` requires `confirm=true`. Both are flagged `destructiveHint` for the client.
- **Spec-as-context** — the OCTO spec is served as MCP resources (`octo://spec/...`) so a coding agent can ground integrations in the real spec.

## Quickstart

```bash
npm install
npm run smoke      # end-to-end test through the real MCP surface (12 checks)
npm run build      # compile to dist/
npm start          # run the server over stdio
npm run inspect     # open the MCP Inspector against it
```

### Use it from Claude Desktop / Claude Code

After `npm run build`, add to your MCP client config (see `claude-desktop-config.example.json`):

```json
{
  "mcpServers": {
    "octo": { "command": "node", "args": ["/home/jason/Documents/octo-mcp-server/dist/index.js"] }
  }
}
```

Then try: *"Find me a Galápagos snorkeling tour, check availability for two weeks from now, and hold 2 adults and 1 child."* The agent will discover → check → hold, then stop and ask you to approve the charge before confirming.

## Conversational web chat (browser ↔ MCP)

A browser can't speak stdio MCP directly, so `scripts/bridge.ts` is a thin **MCP client** that exposes the server over HTTP and serves the `web/` page:

```
browser chat  →  /api/chat  →  bridge (MCP client)  →  octo-mcp-server (stdio)  →  OCTO suppliers
```

```bash
npm run bridge      # builds, connects to the MCP server, serves http://localhost:8787
```

Open **http://localhost:8787** and use the "Ask Meridian" bar. Two brains:

- **Deterministic** (default, no key) — parses destination/date/party and calls the MCP tools. Works offline/free.
- **Claude agent** — auto-enabled if `ANTHROPIC_API_KEY` is in `.env`; Claude reads each message and calls the MCP tools itself. Set `OCTO_CHAT_MODEL` to override the model (default `claude-sonnet-4-6`).

Every chat result comes from real MCP tool calls (including the live Ventrata supplier when `.env` has credentials). The booking conversation honours the same gate as the server: it holds a slot, then only confirms after you explicitly approve.

## Tools

| Tool | Kind | Notes |
|------|------|-------|
| `list_suppliers` | read | Suppliers this server fronts |
| `search_products` | read | Cross-supplier search; human-readable cards + from-price |
| `get_product_details` | read | Full detail: highlights, times, ticket prices, policy |
| `check_availability` | read | Date/range → bookable **slot handles** with prices |
| `create_hold` | write | Reserves inventory (ON_HOLD); server mints the uuid; returns `BK-n` + expiry |
| `confirm_booking` | write · destructive | **Charges the customer** — refuses unless `humanApproved=true` |
| `cancel_booking` | write · destructive | Requires `confirm=true` |
| `get_booking` / `list_bookings` | read | Booking status |

Resources: `octo://suppliers`, `octo://catalog/{supplierId}`, `octo://product/{supplierId}/{productId}`, `octo://booking/{bookingRef}`, `octo://spec/{section}`.
Prompts: `plan-and-book-experience`, `explain-octo-booking-flow`.

## Architecture

```
src/
  index.ts          entrypoint (stdio)
  server.ts         assembles registry + session, registers tools/resources/prompts
  registry.ts       SupplierRegistry — routes supplierId → adapter (one server, many suppliers)
  session.ts        CartSession — server-owned slot/booking handles + idempotency uuid
  money.ts          integer+precision → "€45.00 EUR"
  format.ts         human-readable projection shown to the model
  spec.ts           embedded OCTO spec, served as resources
  tools.ts          the intent-level tools
  resources.ts      resource registrations
  prompts.ts        prompt workflows
  octo/
    types.ts        OCTO domain types (Supplier/Product/Option/Unit/Availability/Booking/Price)
    adapter.ts      OctoSupplierAdapter interface (the seam)
    mockAdapter.ts  spec-accurate in-memory suppliers (fixtures + dynamic availability)
    httpAdapter.ts  stub for a real OCTO REST endpoint (Bearer + Octo-Capabilities)
```

## Going to a real OCTO endpoint

Implement the request/response mapping in `src/octo/httpAdapter.ts` (the headers — Bearer
auth + `Octo-Capabilities` — are already wired), then in `src/server.ts` register an
`HttpOctoAdapter` alongside or instead of the mocks. Nothing else changes — that's the
adapter seam doing its job.

## Design rationale

See [`DESIGN.md`](./DESIGN.md) for the full reasoning (why not mirror REST 1:1, the two
server archetypes, and the standards-governance question this raises for OCTO).

## License

MIT. Built as a reference artifact for the OCTO AI Advisory Board conversation.
