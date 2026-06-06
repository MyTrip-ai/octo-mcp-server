/**
 * CartSession — the server-owned state that hides OCTO's opaque IDs from the model.
 * DESIGN PRINCIPLE #2 (the single most important one).
 *
 * OCTO's flow threads opaque IDs between calls: check_availability returns an
 * `availabilityId`, which you pass to create a booking, which returns a `uuid`,
 * which you pass to confirm. LLMs fumble this exact relay. So the server keeps the
 * IDs and gives the model friendly handles instead:
 *
 *   check_availability  → returns slot handles like "slot-3"
 *   create_hold(slot-3) → returns a booking ref like "BK-1" (server generates the uuid)
 *   confirm_booking(BK-1)
 *
 * The model only ever says "book slot-3" / "confirm BK-1". IDs and the idempotency
 * uuid (DESIGN PRINCIPLE #6) stay server-side.
 */

import { randomUUID } from "node:crypto";

export interface ResolvedSlot {
  handle: string;
  supplierId: string;
  productId: string;
  productName: string;
  optionId: string;
  availabilityId: string;
  localDateTimeStart: string;
  localDateTimeEnd: string;
  vacancies: number;
  currency: string;
  currencyPrecision: number;
  /** unit type → {unitId, retail} for building unitItems + showing prices. */
  units: Array<{ unitId: string; unitType: string; retail: number }>;
}

export interface BookingRef {
  ref: string;
  supplierId: string;
  uuid: string;
}

export class CartSession {
  private slotSeq = 0;
  private bookingSeq = 0;
  private readonly slots = new Map<string, ResolvedSlot>();
  private readonly bookings = new Map<string, BookingRef>();

  addSlot(slot: Omit<ResolvedSlot, "handle">): ResolvedSlot {
    const handle = `slot-${++this.slotSeq}`;
    const full: ResolvedSlot = { ...slot, handle };
    this.slots.set(handle, full);
    return full;
  }

  getSlot(handle: string): ResolvedSlot | undefined {
    return this.slots.get(handle);
  }

  /** Mint a booking ref + the OCTO idempotency uuid. The model never sees the uuid. */
  newBooking(supplierId: string): BookingRef {
    const ref = `BK-${++this.bookingSeq}`;
    const entry: BookingRef = { ref, supplierId, uuid: randomUUID() };
    this.bookings.set(ref, entry);
    return entry;
  }

  getBooking(ref: string): BookingRef | undefined {
    return this.bookings.get(ref);
  }

  allBookings(): BookingRef[] {
    return [...this.bookings.values()];
  }
}
