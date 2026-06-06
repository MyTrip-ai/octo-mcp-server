# Design rationale — an MCP server for OCTO

This server is deliberately **not** a 1:1 wrapper of the OCTO REST API. The whole point
is to show what an OCTO-for-agents layer *should* look like. Below is the reasoning,
mapped to where it lives in the code.

## The core insight: don't mirror REST

LLM agents are bad at exactly what OCTO's wire protocol demands:

- **Stateful multi-step orchestration** (availability → hold → confirm) threading **opaque IDs** (`availabilityId`, booking `uuid`) between calls.
- **Hold-expiry timing** (`utcExpiresAt`) — models lose track of deadlines.
- **Integer money** (`18000` = $180.00) — models misread the raw integer.
- **Capability headers** (`Octo-Capabilities`) — transport plumbing the model shouldn't manage.
- **Irreversible, money-moving actions** — `confirm` charges; `cancel` is destructive.

So the optimal server presents **intent-level tools over server-managed state**, and keeps
the dangerous plumbing server-side.

## The 13 principles (and where they live)

1. **Intent-level tools, not a REST mirror.** — `src/tools.ts`
2. **Server owns opaque IDs + session/cart state.** Model uses `slot-3` / `BK-1`. — `src/session.ts`
3. **Money normalized to human strings.** Raw integers never reach the model. — `src/money.ts`, `src/format.ts`
4. **Capabilities negotiated server-side** via the `Octo-Capabilities` header. — `src/octo/adapter.ts`, `httpAdapter.ts`
5. **Human-in-the-loop on spend/cancel.** `confirm_booking` refuses without `humanApproved=true`; both confirm/cancel carry `destructiveHint`. — `src/tools.ts`
6. **Idempotency owned by the server.** The booking `uuid` is minted server-side; the model can't double-book. — `src/session.ts`
7. **One server, many suppliers.** Uniquely enabled by OCTO's standardization. — `src/registry.ts`
8. **Hold-expiry as a first-class concept** surfaced as a human countdown. — `src/format.ts`
9. **Error normalization** to model-actionable guidance. — `OctoError` in `src/octo/adapter.ts`
10. **Sandbox/mock mode** — runs with zero credentials. — `src/octo/mockAdapter.ts`
11. **Auth kept server-side.** Per-supplier API keys never exposed to the model. — `src/octo/httpAdapter.ts`
12. **Observability** — every booking action is an auditable, server-mediated step (this demo logs to stderr; production would persist an audit trail).
13. **Spec-as-resources** — turns "AI-improved docs" into working tooling. — `src/spec.ts`, `src/resources.ts`

### What a production build adds

- **MCP elicitation** for the human-approval step (this demo uses an explicit `humanApproved` flag so it runs in any client today; elicitation is the richer upgrade once clients support it broadly).
- **Remote transport** (Streamable HTTP) + **OAuth 2.1** for the reseller, instead of stdio.
- **Persistent audit log** and per-session carts keyed to an authenticated principal.
- **Notifications** (`octo/notifications`) surfaced as resource updates.

## Two server archetypes

This repo is **Server A — the Booking Agent server** (agent↔supplier). The companion
design is **Server B — the Developer/Implementation Assistant server**, whose tools are
`validate_octo_response`, `explain_capability`, `generate_client_code`,
`run_sandbox_booking_lifecycle`, and which serves the spec/OpenAPI/error-catalog as
resources. Server B directly serves OCTO's "documentation, tooling, developer experience"
and "member onboarding" objectives. The `octo://spec/*` resources here are a seed of it.

## The standards-governance question (for the OCTO board)

An MCP layer forces choices OCTO should own as a standard:

1. **One canonical OCTO MCP reference server** (in the `octotravel` GitHub org), or each implementer ships its own?
2. **Should "agent-readiness" become an OCTO capability?** e.g. `octo/ai-content` (machine-reasoned policy/eligibility/"good-for" fields) so suppliers can advertise it, and/or a documented `octo/mcp` profile.
3. **Trust & settlement for agent-initiated bookings** — how do suppliers authorize and audit an autonomous agent acting as a reseller?

Framing these is the contribution: it positions OCTO as a *definer* of the agent-era
distribution stack, not a follower.
