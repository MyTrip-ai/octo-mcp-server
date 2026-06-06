/**
 * HttpOctoAdapter — adapter for a REAL OCTO REST endpoint.
 *
 * Implemented and verified against Ventrata's live OCTO API (EdinExplore test
 * supplier). It demonstrates the two things the design keeps server-side and never
 * exposes to the model:
 *   (1) the Bearer API key (DESIGN PRINCIPLE #11), and
 *   (2) the `Octo-Capabilities` header negotiation (DESIGN PRINCIPLE #4).
 *
 * Vendor quirks live behind this seam, e.g. Bókun uses the `Authentication` header
 * (not `Authorization`) and appends `/{vendorId}` to the token — set `authHeader`
 * and `vendorId` and nothing else in the server changes.
 */

import { OctoError, type OctoSupplierAdapter } from "./adapter.js";
import { OCTO_CAPABILITIES, type OctoCapability } from "./types.js";
import type {
  Availability,
  AvailabilityCheckRequest,
  Booking,
  ConfirmBookingRequest,
  CreateBookingRequest,
  Option,
  Price,
  Product,
  Supplier,
  Unit,
} from "./types.js";

export interface HttpOctoConfig {
  supplierId: string;
  /** e.g. "https://api.ventrata.com/octo" or "https://api.bokuntest.com/octo/v1" */
  baseUrl: string;
  apiKey: string;
  capabilities?: OctoCapability[];
  /** Display/booking currency to select from multi-currency OCTO pricing. */
  currency?: string;
  /** Header name for the token. "Authorization" (Ventrata, default) or "Authentication" (Bókun). */
  authHeader?: string;
  /** Bókun appends the vendor id to the token: `Bearer <token>/<vendorId>`. */
  vendorId?: string;
}

type Json = Record<string, unknown>;

export class HttpOctoAdapter implements OctoSupplierAdapter {
  readonly supplierId: string;
  readonly capabilities: OctoCapability[];
  private readonly currency: string;

  constructor(private readonly config: HttpOctoConfig) {
    this.supplierId = config.supplierId;
    this.capabilities = config.capabilities ?? [OCTO_CAPABILITIES.pricing, OCTO_CAPABILITIES.content];
    this.currency = config.currency ?? "USD";
  }

  private headers(): Record<string, string> {
    const name = this.config.authHeader ?? "Authorization";
    const token = this.config.vendorId ? `${this.config.apiKey}/${this.config.vendorId}` : this.config.apiKey;
    return {
      [name]: `Bearer ${token}`,
      "Octo-Capabilities": this.capabilities.join(", "),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.config.baseUrl + path, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const txt = await res.text();
    let json: unknown = null;
    try {
      json = txt ? JSON.parse(txt) : null;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const j = (json ?? {}) as Json;
      const msg = (j.errorMessage as string) ?? (j.error as string) ?? txt.slice(0, 200) ?? res.statusText;
      throw new OctoError(
        `OCTO ${method} ${path} → ${res.status}: ${msg}`,
        res.status === 403 ? "Check the API key / credentials for this supplier." : undefined,
      );
    }
    return json as T;
  }

  // ── pricing helpers ────────────────────────────────────────────────
  private pickPrice(arr: Array<Price> | undefined): Price | undefined {
    if (!arr || arr.length === 0) return undefined;
    return arr.find((p) => p.currency === this.currency) ?? arr[0];
  }

  private mapUnitPricing(up: Array<Price & { unitId: string; unitType: string }> | undefined): Availability["unitPricing"] {
    if (!up || up.length === 0) return [];
    let chosen = up.filter((p) => p.currency === this.currency);
    if (chosen.length === 0) {
      // fall back to one price per unit (first currency seen)
      const seen = new Set<string>();
      chosen = up.filter((p) => (seen.has(p.unitId) ? false : (seen.add(p.unitId), true)));
    }
    return chosen.map((p) => ({
      unitId: p.unitId,
      unitType: p.unitType as Unit["type"],
      original: p.original,
      retail: p.retail,
      net: p.net,
      currency: p.currency,
      currencyPrecision: p.currencyPrecision,
      includedTaxes: p.includedTaxes ?? [],
    }));
  }

  // ── mappers (real OCTO JSON → our trimmed types) ───────────────────
  private mapUnit(u: Json): Unit {
    const r = (u.restrictions ?? {}) as Json;
    return {
      id: u.id as string,
      type: (u.type as Unit["type"]) ?? "ADULT",
      internalName: (u.internalName as string) ?? (u.title as string) ?? (u.type as string) ?? "",
      reference: (u.reference as string) ?? "",
      restrictions: {
        minAge: r.minAge as number | undefined,
        maxAge: r.maxAge as number | undefined,
        idRequired: r.idRequired as boolean | undefined,
        minQuantity: (r.minQuantity as number | null) ?? null,
        maxQuantity: (r.maxQuantity as number | null) ?? null,
      },
      pricing: this.pickPrice(u.pricingFrom as Price[] | undefined) ?? this.pickPrice(u.pricing as Price[] | undefined),
    };
  }

  private mapOption(o: Json): Option {
    const r = (o.restrictions ?? {}) as Json;
    return {
      id: o.id as string,
      default: Boolean(o.default),
      internalName: (o.internalName as string) ?? "",
      availabilityLocalStartTimes: (o.availabilityLocalStartTimes as string[]) ?? [],
      cancellationCutoff: (o.cancellationCutoff as string) ?? "",
      requiredContactFields: (o.requiredContactFields as string[]) ?? [],
      restrictions: { minUnits: (r.minUnits as number) ?? 1, maxUnits: (r.maxUnits as number | null) ?? null },
      units: ((o.units as Json[]) ?? []).map((u) => this.mapUnit(u)),
    };
  }

  private mapProduct(p: Json): Product {
    return {
      id: p.id as string,
      internalName: (p.internalName as string) ?? (p.title as string) ?? "",
      reference: (p.reference as string) ?? "",
      locale: (p.locale as string) ?? "en",
      timeZone: (p.timeZone as string) ?? "UTC",
      availabilityType: (p.availabilityType as Product["availabilityType"]) ?? "START_TIME",
      redemptionMethod: (p.redemptionMethod as Product["redemptionMethod"]) ?? "DIGITAL",
      instantConfirmation: Boolean(p.instantConfirmation),
      instantDelivery: Boolean(p.instantDelivery),
      availabilityRequired: p.availabilityRequired !== undefined ? Boolean(p.availabilityRequired) : !p.allowFreesale,
      deliveryMethods: (p.deliveryMethods as Product["deliveryMethods"]) ?? [],
      durationMinutes: 0, // not provided at product level by OCTO; availability carries start/end
      options: ((p.options as Json[]) ?? []).map((o) => this.mapOption(o)),
      content: {
        title: (p.title as string) ?? (p.internalName as string) ?? "",
        shortDescription: (p.shortDescription as string) ?? (p.subtitle as string) ?? (p.tagline as string) ?? "",
        highlights: (p.highlights as string[]) ?? [],
        location: (p.location as string) ?? (p.address as string) ?? "",
      },
    };
  }

  private mapAvailability(a: Json): Availability {
    return {
      id: a.id as string,
      localDateTimeStart: a.localDateTimeStart as string,
      localDateTimeEnd: a.localDateTimeEnd as string,
      allDay: Boolean(a.allDay),
      available: Boolean(a.available),
      status: (a.status as Availability["status"]) ?? "AVAILABLE",
      vacancies: (a.vacancies as number) ?? 0,
      capacity: (a.capacity as number) ?? 0,
      maxUnits: (a.maxUnits as number | null) ?? null,
      unitPricing: this.mapUnitPricing(a.unitPricing as Array<Price & { unitId: string; unitType: string }> | undefined),
    };
  }

  private mapBooking(b: Json): Booking {
    const contact = (b.contact ?? null) as Json | null;
    const voucher = (b.voucher ?? null) as Json | null;
    const deliveryOptions = (voucher?.deliveryOptions as Json[]) ?? [];
    const pricing = b.pricing as Price | undefined;
    return {
      uuid: b.uuid as string,
      status: (b.status as Booking["status"]) ?? "PENDING",
      supplierReference: (b.supplierReference as string | null) ?? null,
      productId: b.productId as string,
      optionId: b.optionId as string,
      availabilityId: b.availabilityId as string,
      localDateTimeStart: b.localDateTimeStart as string,
      localDateTimeEnd: b.localDateTimeEnd as string,
      utcExpiresAt: (b.utcExpiresAt as string | null) ?? null,
      cancellable: Boolean(b.cancellable),
      contact: contact
        ? {
            fullName: (contact.fullName as string) ?? "",
            emailAddress: (contact.emailAddress as string) ?? "",
            phoneNumber: contact.phoneNumber as string | undefined,
            country: contact.country as string | undefined,
          }
        : null,
      unitItems: ((b.unitItems as Json[]) ?? []).map((u) => ({ unitId: u.unitId as string })),
      deliveryMethods: (b.deliveryMethods as Booking["deliveryMethods"]) ?? [],
      pricing: pricing ? { ...pricing, includedTaxes: pricing.includedTaxes ?? [] } : undefined,
      voucher: deliveryOptions.length
        ? { deliveryFormat: deliveryOptions[0].deliveryFormat as string, deliveryValue: deliveryOptions[0].deliveryValue as string }
        : null,
    };
  }

  // ── OctoSupplierAdapter ────────────────────────────────────────────
  async getSupplier(): Promise<Supplier> {
    const s = await this.req<Json>("GET", "/supplier");
    const contact = (s.contact ?? {}) as Json;
    return {
      id: this.supplierId, // keep routing id stable; display the real name
      name: (s.name as string) ?? this.supplierId,
      locale: "en",
      timeZone: (s.timeZone as string) ?? "UTC",
      currency: this.currency,
      contact: { website: (contact.website as string) ?? undefined, email: (contact.email as string) ?? undefined },
    };
  }

  async listProducts(): Promise<Product[]> {
    const ps = await this.req<Json[]>("GET", "/products");
    return (ps ?? []).map((p) => this.mapProduct(p));
  }

  async getProduct(productId: string): Promise<Product | null> {
    try {
      const p = await this.req<Json>("GET", `/products/${productId}`);
      return p ? this.mapProduct(p) : null;
    } catch {
      return null; // not this supplier's product (or not found)
    }
  }

  async checkAvailability(req: AvailabilityCheckRequest): Promise<Availability[]> {
    const body = { productId: req.productId, optionId: req.optionId, localDateStart: req.localDateStart, localDateEnd: req.localDateEnd ?? req.localDateStart };
    const as = await this.req<Json[]>("POST", "/availability", body);
    return (as ?? []).map((a) => this.mapAvailability(a));
  }

  async createBooking(req: CreateBookingRequest): Promise<Booking> {
    const b = await this.req<Json>("POST", "/bookings", {
      uuid: req.uuid,
      productId: req.productId,
      optionId: req.optionId,
      availabilityId: req.availabilityId,
      unitItems: req.unitItems,
    });
    return this.mapBooking(b);
  }

  async confirmBooking(uuid: string, req: ConfirmBookingRequest): Promise<Booking> {
    const b = await this.req<Json>("POST", `/bookings/${uuid}/confirm`, { contact: req.contact });
    return this.mapBooking(b);
  }

  async cancelBooking(uuid: string): Promise<Booking> {
    const b = await this.req<Json>("POST", `/bookings/${uuid}/cancel`);
    return this.mapBooking(b);
  }

  async getBooking(uuid: string): Promise<Booking | null> {
    try {
      const b = await this.req<Json>("GET", `/bookings/${uuid}`);
      return b ? this.mapBooking(b) : null;
    } catch {
      return null;
    }
  }
}
