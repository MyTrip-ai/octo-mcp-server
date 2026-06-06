/**
 * MockOctoAdapter — a spec-accurate, in-memory OCTO supplier. Zero credentials.
 *
 * It implements the SAME OctoSupplierAdapter interface a real HTTP-backed supplier
 * would, so the rest of the server can't tell the difference. Availability is
 * generated dynamically relative to "today" so the demo never goes stale.
 */

import { randomUUID } from "node:crypto";
import { OCTO_CAPABILITIES, type OctoCapability } from "./types.js";
import { OctoError, type OctoSupplierAdapter } from "./adapter.js";
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
  UnitType,
} from "./types.js";

const PRECISION = 2;
const SEP = "~"; // delimiter used to make mock availabilityIds self-describing

function price(currency: string, retail: number, net: number, original: number, tax?: { name: string; retail: number; net: number }): Price {
  return {
    original,
    retail,
    net,
    currency,
    currencyPrecision: PRECISION,
    includedTaxes: tax ? [tax] : [],
  };
}

function unit(id: string, type: UnitType, p: Price, restrictions: Unit["restrictions"] = {}): Unit {
  return { id, type, internalName: `${type[0]}${type.slice(1).toLowerCase()}`, reference: id, restrictions, pricing: p };
}

/** Naive local datetime helpers (treat the string as wall-clock, no tz math drift). */
function fmtLocal(d: Date): string {
  return d.toISOString().slice(0, 19); // "YYYY-MM-DDTHH:MM:SS"
}
function addMinutes(localStart: string, minutes: number): string {
  const d = new Date(`${localStart}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return fmtLocal(d);
}
function* iterateDates(startDate: string, endDate: string, cap = 14): Generator<string> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let count = 0;
  for (let d = new Date(start); d <= end && count < cap; d.setUTCDate(d.getUTCDate() + 1), count++) {
    yield d.toISOString().slice(0, 10);
  }
}
/** Deterministic pseudo-vacancy so demos/tests are reproducible (no Math.random). */
function deterministicVacancies(seed: string, capacity: number): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return (h % capacity) + 1;
}

export interface MockSupplierSeed {
  supplier: Supplier;
  products: Product[];
}

export class MockOctoAdapter implements OctoSupplierAdapter {
  readonly capabilities: OctoCapability[] = [OCTO_CAPABILITIES.pricing, OCTO_CAPABILITIES.content];
  private readonly bookings = new Map<string, Booking>();

  constructor(private readonly seed: MockSupplierSeed) {}

  get supplierId(): string {
    return this.seed.supplier.id;
  }

  async getSupplier(): Promise<Supplier> {
    return this.seed.supplier;
  }

  async listProducts(): Promise<Product[]> {
    return this.seed.products;
  }

  async getProduct(productId: string): Promise<Product | null> {
    return this.seed.products.find((p) => p.id === productId) ?? null;
  }

  async checkAvailability(req: AvailabilityCheckRequest): Promise<Availability[]> {
    const product = await this.getProduct(req.productId);
    if (!product) throw new OctoError(`Product '${req.productId}' not found.`, "Call search_products to find a valid productId.");
    const option = product.options.find((o) => o.id === req.optionId);
    if (!option) throw new OctoError(`Option '${req.optionId}' not found on product '${req.productId}'.`);

    const out: Availability[] = [];
    const capacity = 20;
    for (const date of iterateDates(req.localDateStart, req.localDateEnd ?? req.localDateStart)) {
      for (const startTime of option.availabilityLocalStartTimes) {
        const localDateTimeStart = `${date}T${startTime}:00`;
        const localDateTimeEnd = addMinutes(localDateTimeStart, product.durationMinutes);
        const vacancies = deterministicVacancies(localDateTimeStart + option.id, capacity);
        out.push({
          id: [product.id, option.id, localDateTimeStart].join(SEP),
          localDateTimeStart,
          localDateTimeEnd,
          allDay: false,
          available: vacancies > 0,
          status: vacancies === 0 ? "SOLD_OUT" : vacancies <= 4 ? "LIMITED" : "AVAILABLE",
          vacancies,
          capacity,
          maxUnits: option.restrictions.maxUnits,
          unitPricing: option.units.map((u) => ({ ...(u.pricing as Price), unitId: u.id, unitType: u.type })),
        });
      }
    }
    return out;
  }

  private resolveAvailabilityId(availabilityId: string): { product: Product; option: Option; localDateTimeStart: string } {
    const [productId, optionId, localDateTimeStart] = availabilityId.split(SEP);
    const product = this.seed.products.find((p) => p.id === productId);
    const option = product?.options.find((o) => o.id === optionId);
    if (!product || !option || !localDateTimeStart) {
      throw new OctoError(`availabilityId '${availabilityId}' is not valid.`, "Re-run check_availability to get a fresh slot.");
    }
    return { product, option, localDateTimeStart };
  }

  async createBooking(req: CreateBookingRequest): Promise<Booking> {
    const { product, option, localDateTimeStart } = this.resolveAvailabilityId(req.availabilityId);

    if (req.unitItems.length === 0) throw new OctoError("A booking needs at least one unit (e.g. one Adult).");
    const validUnitIds = new Set(option.units.map((u) => u.id));
    for (const item of req.unitItems) {
      if (!validUnitIds.has(item.unitId)) throw new OctoError(`Unit '${item.unitId}' is not valid for this option.`);
    }

    const pricing = this.sumPricing(option, req.unitItems);
    const expiresInMin = req.expirationMinutes ?? 30;
    const utcExpiresAt = new Date(Date.now() + expiresInMin * 60_000).toISOString();

    const booking: Booking = {
      uuid: req.uuid,
      status: "ON_HOLD",
      supplierReference: null,
      productId: product.id,
      optionId: option.id,
      availabilityId: req.availabilityId,
      localDateTimeStart,
      localDateTimeEnd: addMinutes(localDateTimeStart, product.durationMinutes),
      utcExpiresAt,
      cancellable: true,
      contact: null,
      unitItems: req.unitItems.map((u) => ({ unitId: u.unitId })),
      deliveryMethods: product.deliveryMethods,
      pricing,
      voucher: null,
    };
    this.bookings.set(req.uuid, booking);
    return booking;
  }

  async confirmBooking(uuid: string, req: ConfirmBookingRequest): Promise<Booking> {
    const booking = this.bookings.get(uuid);
    if (!booking) throw new OctoError(`Booking '${uuid}' not found.`);
    if (booking.status === "CONFIRMED") return booking; // idempotent re-confirm
    if (booking.status !== "ON_HOLD") throw new OctoError(`Booking is '${booking.status}', cannot confirm.`);
    if (booking.utcExpiresAt && new Date(booking.utcExpiresAt).getTime() < Date.now()) {
      booking.status = "EXPIRED";
      throw new OctoError("This hold has expired and capacity was released.", "Run check_availability again and create a new hold.");
    }

    booking.status = "CONFIRMED";
    booking.contact = req.contact;
    booking.supplierReference = `${this.supplierId.slice(0, 3).toUpperCase()}-${uuid.slice(0, 8)}`;
    booking.utcExpiresAt = null;
    booking.voucher = { deliveryFormat: "QRCODE", deliveryValue: `https://tickets.example/${uuid}` };
    booking.unitItems = booking.unitItems.map((u) => ({
      ...u,
      ticket: { redemptionMethod: "DIGITAL", deliveryOptions: [{ deliveryFormat: "QRCODE", deliveryValue: `https://tickets.example/${uuid}/${u.unitId}` }] },
    }));
    return booking;
  }

  async cancelBooking(uuid: string): Promise<Booking> {
    const booking = this.bookings.get(uuid);
    if (!booking) throw new OctoError(`Booking '${uuid}' not found.`);
    if (!booking.cancellable) throw new OctoError("This booking is not cancellable (past the cancellation cutoff).");
    booking.status = "CANCELLED";
    booking.utcExpiresAt = null;
    return booking;
  }

  async getBooking(uuid: string): Promise<Booking | null> {
    return this.bookings.get(uuid) ?? null;
  }

  private sumPricing(option: Option, unitItems: Array<{ unitId: string }>): Price {
    const byId = new Map(option.units.map((u) => [u.id, u.pricing as Price]));
    const first = byId.get(unitItems[0].unitId)!;
    const acc: Price = { original: 0, retail: 0, net: 0, currency: first.currency, currencyPrecision: first.currencyPrecision, includedTaxes: [] };
    const taxByName = new Map<string, { name: string; retail: number; net: number }>();
    for (const item of unitItems) {
      const p = byId.get(item.unitId)!;
      acc.original += p.original;
      acc.retail += p.retail;
      acc.net += p.net;
      for (const t of p.includedTaxes) {
        const existing = taxByName.get(t.name) ?? { name: t.name, retail: 0, net: 0 };
        existing.retail += t.retail;
        existing.net += t.net;
        taxByName.set(t.name, existing);
      }
    }
    acc.includedTaxes = [...taxByName.values()];
    return acc;
  }
}

// ───────────────────────────── Fixtures (two suppliers) ─────────────────────────────

const EUR = "EUR";
const USD = "USD";

const reykjavik: MockSupplierSeed = {
  supplier: {
    id: "reykjavik-excursions",
    name: "Reykjavík Excursions",
    locale: "en",
    timeZone: "Atlantic/Reykjavik",
    currency: EUR,
    contact: { website: "https://example.com/re", email: "bookings@example-re.test" },
  },
  products: [
    {
      id: "re-golden-circle",
      internalName: "Golden Circle Classic Day Tour",
      reference: "GC-CLASSIC",
      locale: "en",
      timeZone: "Atlantic/Reykjavik",
      availabilityType: "START_TIME",
      redemptionMethod: "DIGITAL",
      instantConfirmation: true,
      instantDelivery: true,
      availabilityRequired: true,
      deliveryMethods: ["TICKET"],
      durationMinutes: 480,
      content: {
        title: "Golden Circle Classic Day Tour",
        shortDescription: "Þingvellir National Park, the Geysir geothermal area, and Gullfoss waterfall in one day.",
        highlights: ["UNESCO-listed Þingvellir", "Erupting Strokkur geyser", "Gullfoss waterfall", "Hotel pickup included"],
        location: "Reykjavík, Iceland",
      },
      options: [
        {
          id: "re-gc-default",
          default: true,
          internalName: "Standard departure",
          availabilityLocalStartTimes: ["08:30", "13:00"],
          cancellationCutoff: "24 hours before start",
          requiredContactFields: ["fullName", "emailAddress"],
          restrictions: { minUnits: 1, maxUnits: 30 },
          units: [
            unit("re-gc-adult", "ADULT", price(EUR, 9900, 7920, 11000, { name: "VAT 11%", retail: 981, net: 785 }), { minAge: 16 }),
            unit("re-gc-child", "CHILD", price(EUR, 4950, 3960, 5500, { name: "VAT 11%", retail: 490, net: 392 }), { minAge: 3, maxAge: 15 }),
            unit("re-gc-senior", "SENIOR", price(EUR, 8900, 7120, 9900, { name: "VAT 11%", retail: 882, net: 705 }), { minAge: 67 }),
          ],
        },
      ],
    },
    {
      id: "re-northern-lights",
      internalName: "Northern Lights Hunt",
      reference: "NL-HUNT",
      locale: "en",
      timeZone: "Atlantic/Reykjavik",
      availabilityType: "START_TIME",
      redemptionMethod: "DIGITAL",
      instantConfirmation: true,
      instantDelivery: true,
      availabilityRequired: true,
      deliveryMethods: ["TICKET"],
      durationMinutes: 210,
      content: {
        title: "Northern Lights Hunt",
        shortDescription: "Evening aurora-chasing tour with expert guides who follow the clearest skies.",
        highlights: ["Free re-tour if no aurora appears", "Small-group minibuses", "Hot chocolate included"],
        location: "Reykjavík, Iceland",
      },
      options: [
        {
          id: "re-nl-default",
          default: true,
          internalName: "Evening departure",
          availabilityLocalStartTimes: ["20:00", "22:00"],
          cancellationCutoff: "24 hours before start",
          requiredContactFields: ["fullName", "emailAddress", "phoneNumber"],
          restrictions: { minUnits: 1, maxUnits: 19 },
          units: [
            unit("re-nl-adult", "ADULT", price(EUR, 6900, 5520, 6900, { name: "VAT 11%", retail: 683, net: 547 }), { minAge: 16 }),
            unit("re-nl-child", "CHILD", price(EUR, 3450, 2760, 3450, { name: "VAT 11%", retail: 342, net: 273 }), { minAge: 6, maxAge: 15 }),
          ],
        },
      ],
    },
  ],
};

const galapagos: MockSupplierSeed = {
  supplier: {
    id: "galapagos-day-tours",
    name: "Galápagos Day Tours",
    locale: "en",
    timeZone: "Pacific/Galapagos",
    currency: USD,
    contact: { website: "https://example.com/gdt", email: "reservas@example-gdt.test" },
  },
  products: [
    {
      id: "gdt-bartolome-snorkel",
      internalName: "Bartolomé Island Snorkel Day Trip",
      reference: "BARTOLOME",
      locale: "en",
      timeZone: "Pacific/Galapagos",
      availabilityType: "START_TIME",
      redemptionMethod: "MANIFEST",
      instantConfirmation: false,
      instantDelivery: false,
      availabilityRequired: true,
      deliveryMethods: ["VOUCHER"],
      durationMinutes: 600,
      content: {
        title: "Bartolomé Island Snorkel Day Trip",
        shortDescription: "Boat day trip to Bartolomé: Pinnacle Rock viewpoint and snorkeling with sea lions and penguins.",
        highlights: ["Pinnacle Rock panorama", "Snorkel with Galápagos penguins", "Lunch aboard", "Bilingual naturalist guide"],
        location: "Santa Cruz, Galápagos, Ecuador",
      },
      options: [
        {
          id: "gdt-bart-default",
          default: true,
          internalName: "Full-day departure",
          availabilityLocalStartTimes: ["07:00"],
          cancellationCutoff: "48 hours before start",
          requiredContactFields: ["fullName", "emailAddress", "country"],
          restrictions: { minUnits: 1, maxUnits: 16 },
          units: [
            unit("gdt-bart-adult", "ADULT", price(USD, 18000, 14400, 18000), { minAge: 12 }),
            unit("gdt-bart-child", "CHILD", price(USD, 12000, 9600, 12000), { minAge: 4, maxAge: 11 }),
          ],
        },
      ],
    },
    {
      id: "gdt-tortoise-lava",
      internalName: "Tortoise Reserve & Lava Tunnels",
      reference: "TORTOISE-LAVA",
      locale: "en",
      timeZone: "Pacific/Galapagos",
      availabilityType: "START_TIME",
      redemptionMethod: "DIGITAL",
      instantConfirmation: true,
      instantDelivery: true,
      availabilityRequired: true,
      deliveryMethods: ["TICKET"],
      durationMinutes: 300,
      content: {
        title: "Tortoise Reserve & Lava Tunnels",
        shortDescription: "Highlands half-day: giant tortoises in the wild and a walk through underground lava tunnels.",
        highlights: ["Wild giant tortoises", "Walk-through lava tunnels", "Highlands scenery", "Boots provided"],
        location: "Santa Cruz, Galápagos, Ecuador",
      },
      options: [
        {
          id: "gdt-tl-default",
          default: true,
          internalName: "Morning departure",
          availabilityLocalStartTimes: ["09:00"],
          cancellationCutoff: "24 hours before start",
          requiredContactFields: ["fullName", "emailAddress"],
          restrictions: { minUnits: 1, maxUnits: 12 },
          units: [
            unit("gdt-tl-adult", "ADULT", price(USD, 9500, 7600, 9500)),
            unit("gdt-tl-child", "CHILD", price(USD, 6000, 4800, 6000), { minAge: 4, maxAge: 11 }),
          ],
        },
      ],
    },
  ],
};

/** The default demo fleet: two suppliers, two currencies. */
export function createMockAdapters(): MockOctoAdapter[] {
  return [new MockOctoAdapter(reykjavik), new MockOctoAdapter(galapagos)];
}
