/**
 * Money normalization — DESIGN PRINCIPLE #3.
 *
 * OCTO encodes money as an integer + currencyPrecision (e.g. 4500 @ precision 2
 * means 45.00). LLMs routinely misread the raw integer as "4500 dollars". So we
 * NEVER expose the raw integer to the model: every price reaching the model is a
 * pre-formatted, unambiguous human string like "€45.00 EUR".
 */

const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ISK: "kr",
  CAD: "$",
  AUD: "$",
  MXN: "$",
};

/** Convert OCTO integer money to a real decimal number. */
export function toDecimal(amount: number, currencyPrecision: number): number {
  return amount / 10 ** currencyPrecision;
}

/** Format OCTO integer money as an unambiguous human string, e.g. "€45.00 EUR". */
export function formatMoney(amount: number, currencyPrecision: number, currency: string): string {
  const value = toDecimal(amount, currencyPrecision);
  const fixed = value.toFixed(currencyPrecision);
  const symbol = SYMBOLS[currency] ?? "";
  return symbol ? `${symbol}${fixed} ${currency}` : `${fixed} ${currency}`;
}
