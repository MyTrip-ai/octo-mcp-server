/**
 * HttpOctoAdapter — adapter for a REAL OCTO REST endpoint.
 *
 * This is a STUB included to show the production shape: it demonstrates the two
 * things the design insists stay server-side and never reach the model —
 *   (1) the Bearer API key (DESIGN PRINCIPLE #11), and
 *   (2) the `Octo-Capabilities` header negotiation (DESIGN PRINCIPLE #4).
 *
 * Wiring it to a live sandbox (e.g. a Bókun test host) is a matter of filling in
 * the request/response mapping. It is intentionally not credentialed in the demo.
 */

import { OctoError, type OctoSupplierAdapter } from "./adapter.js";
import { OCTO_CAPABILITIES, type OctoCapability } from "./types.js";
import type {
  Availability,
  AvailabilityCheckRequest,
  Booking,
  ConfirmBookingRequest,
  CreateBookingRequest,
  Product,
  Supplier,
} from "./types.js";

export interface HttpOctoConfig {
  supplierId: string;
  /** e.g. "https://api.bokuntest.com/octo/v1" */
  baseUrl: string;
  /** API key kept server-side; injected as `Authorization: Bearer <key>`. */
  apiKey: string;
  capabilities?: OctoCapability[];
}

export class HttpOctoAdapter implements OctoSupplierAdapter {
  readonly supplierId: string;
  readonly capabilities: OctoCapability[];

  constructor(private readonly config: HttpOctoConfig) {
    this.supplierId = config.supplierId;
    this.capabilities = config.capabilities ?? [OCTO_CAPABILITIES.pricing, OCTO_CAPABILITIES.content];
  }

  /** All requests carry Bearer auth + the negotiated Octo-Capabilities header. */
  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Octo-Capabilities": this.capabilities.join(", "),
      "Content-Type": "application/json",
    };
  }

  private notWired(): never {
    throw new OctoError(
      `HttpOctoAdapter for '${this.supplierId}' is a stub in this demo.`,
      "Use the mock suppliers, or implement the request/response mapping against a live OCTO endpoint.",
    );
  }

  // The method bodies below show the intended request shape; mapping is left as the
  // integration step. They throw a clear, model-actionable error until wired.

  async getSupplier(): Promise<Supplier> {
    // await fetch(`${this.config.baseUrl}/supplier`, { headers: this.headers() })
    void this.headers();
    return this.notWired();
  }
  async listProducts(): Promise<Product[]> {
    // await fetch(`${this.config.baseUrl}/products`, { headers: this.headers() })
    return this.notWired();
  }
  async getProduct(_productId: string): Promise<Product | null> {
    return this.notWired();
  }
  async checkAvailability(_req: AvailabilityCheckRequest): Promise<Availability[]> {
    // POST `${baseUrl}/availability` → returns availabilityId(s)
    return this.notWired();
  }
  async createBooking(_req: CreateBookingRequest): Promise<Booking> {
    // POST `${baseUrl}/bookings` (status ON_HOLD)
    return this.notWired();
  }
  async confirmBooking(_uuid: string, _req: ConfirmBookingRequest): Promise<Booking> {
    // POST `${baseUrl}/bookings/{uuid}/confirm`
    return this.notWired();
  }
  async cancelBooking(_uuid: string): Promise<Booking> {
    // POST `${baseUrl}/bookings/{uuid}/cancel`
    return this.notWired();
  }
  async getBooking(_uuid: string): Promise<Booking | null> {
    return this.notWired();
  }
}
