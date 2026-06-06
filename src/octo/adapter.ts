/**
 * The adapter seam — DESIGN PRINCIPLE #7: "one server, many suppliers".
 *
 * Because every OCTO-compliant supplier speaks the SAME spec, a single MCP server
 * can front all of them. Each supplier is just an implementation of this interface.
 * The MockOctoAdapter (fixtures, zero credentials) and HttpOctoAdapter (a real OCTO
 * REST endpoint over Bearer auth) are interchangeable behind it.
 *
 * Capability negotiation (the `Octo-Capabilities` header) is handled HERE, server-side
 * — DESIGN PRINCIPLE #4 — so the model never touches transport headers.
 */

import type {
  Availability,
  AvailabilityCheckRequest,
  Booking,
  ConfirmBookingRequest,
  CreateBookingRequest,
  OctoCapability,
  Product,
  Supplier,
} from "./types.js";

export interface OctoSupplierAdapter {
  /** Stable id used to route requests, e.g. "galapagos-day-tours". */
  readonly supplierId: string;

  /** Capabilities this adapter applies to every request. */
  readonly capabilities: OctoCapability[];

  getSupplier(): Promise<Supplier>;
  listProducts(): Promise<Product[]>;
  getProduct(productId: string): Promise<Product | null>;
  checkAvailability(req: AvailabilityCheckRequest): Promise<Availability[]>;

  /** Creates an ON_HOLD reservation. The server supplies the uuid + expiry. */
  createBooking(req: CreateBookingRequest): Promise<Booking>;
  /** Transitions ON_HOLD → CONFIRMED. This is the money-moving step. */
  confirmBooking(uuid: string, req: ConfirmBookingRequest): Promise<Booking>;
  /** Cancels a booking (gated by cancellable + cutoff). */
  cancelBooking(uuid: string): Promise<Booking>;
  getBooking(uuid: string): Promise<Booking | null>;
}

/** Raised by adapters with a model-actionable message (DESIGN PRINCIPLE #9). */
export class OctoError extends Error {
  constructor(
    message: string,
    readonly suggestion?: string,
  ) {
    super(message);
    this.name = "OctoError";
  }
}
