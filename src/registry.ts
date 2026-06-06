/**
 * SupplierRegistry — routes a supplierId to its adapter.
 *
 * This is what makes "one server, many OCTO suppliers" concrete: the registry holds
 * any mix of MockOctoAdapter and HttpOctoAdapter instances, all behind the same
 * interface. Tools query across the whole registry; the model never picks a transport.
 */

import { OctoError, type OctoSupplierAdapter } from "./octo/adapter.js";
import type { Product, Supplier } from "./octo/types.js";

export class SupplierRegistry {
  private readonly adapters = new Map<string, OctoSupplierAdapter>();

  constructor(adapters: OctoSupplierAdapter[]) {
    for (const a of adapters) this.adapters.set(a.supplierId, a);
  }

  ids(): string[] {
    return [...this.adapters.keys()];
  }

  get(supplierId: string): OctoSupplierAdapter {
    const a = this.adapters.get(supplierId);
    if (!a) throw new OctoError(`Unknown supplier '${supplierId}'.`, `Known suppliers: ${this.ids().join(", ")}.`);
    return a;
  }

  all(): OctoSupplierAdapter[] {
    return [...this.adapters.values()];
  }

  async suppliers(): Promise<Supplier[]> {
    return Promise.all(this.all().map((a) => a.getSupplier()));
  }

  /** Every product across every supplier, tagged with its supplierId. */
  async allProducts(): Promise<Array<{ supplierId: string; product: Product }>> {
    const out: Array<{ supplierId: string; product: Product }> = [];
    for (const a of this.all()) {
      for (const product of await a.listProducts()) out.push({ supplierId: a.supplierId, product });
    }
    return out;
  }

  /** Find which supplier owns a product. */
  async findProduct(productId: string): Promise<{ supplierId: string; product: Product } | null> {
    for (const a of this.all()) {
      const product = await a.getProduct(productId);
      if (product) return { supplierId: a.supplierId, product };
    }
    return null;
  }
}
