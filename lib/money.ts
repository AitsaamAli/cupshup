/**
 * Money helpers — paisa-integer math.
 *
 * The one rule everything here exists to protect: every amount of money is
 * a whole number of paisa (100 paisa = Rs 1), never a float. Rs 599.00 is
 * the integer 59900, always.
 *
 *   0.1 + 0.2 === 0.30000000000000004
 *   1329 * 0.16 === 212.64000000000001
 *
 * That's not a hypothetical — it's what plain JS float math does (IEEE-754
 * can't represent most decimal fractions exactly). After a few thousand
 * orders, reports stop matching to the paisa. Restricting
 * every money value to `Paisa` (a branded integer type) and routing every
 * operation through these helpers is what keeps that error out entirely.
 *
 * See docs/money-and-calculation-rules.md for the full rounding rule this
 * file implements (`calculateTax`) and why it matters for split payments.
 */

/**
 * A paisa amount. The brand (`__brand`) exists only at the type level —
 * it costs nothing at runtime, but stops a plain `number` (e.g. a Rupee
 * amount, or an array index) from being passed somewhere paisa is
 * expected without going through `rupeesToPaisa()` first.
 */
export type Paisa = number & { readonly __brand: "Paisa" };

/** Converts a Rupee amount (may have decimals) to whole paisa, rounding to the nearest paisa. */
export function rupeesToPaisa(rupees: number): Paisa {
  return Math.round(rupees * 100) as Paisa;
}

/** Converts whole paisa back to a Rupee number. For display/calc only — never for storage. */
export function paisaToRupees(paisa: Paisa | number): number {
  return paisa / 100;
}

/** Formats paisa as a Pakistani-Rupee display string, e.g. 59900 -> "Rs 599.00". */
export function formatPaisa(paisa: Paisa | number): string {
  return (
    "Rs " +
    (paisa / 100).toLocaleString("en-PK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Adds any number of paisa amounts. Integers in, integer out — no float drift. */
export function addPaisa(...amounts: (Paisa | number)[]): Paisa {
  return amounts.reduce((sum: number, a) => sum + a, 0) as Paisa;
}

/** Multiplies a paisa amount by a factor (e.g. unit price × qty), rounding half-up to the nearest paisa. */
export function multiplyPaisa(paisa: Paisa | number, factor: number): Paisa {
  return Math.round(paisa * factor) as Paisa;
}

/**
 * Calculates tax on a base paisa amount at a rate given in basis points
 * (1600 bp = 16.00%, 800 bp = 8.00% — see `tax_rate_bp()` in
 * 0002_tax_functions.sql). Rounds half-up to the nearest paisa.
 *
 * THE ROUNDING RULE (decided once, applied everywhere — never deviate):
 *   - Round separately on EACH payment split, never once on the whole bill.
 *   - Sum the splits AFTER rounding, never before.
 * A bill paid half-cash/half-card must compute tax on each half
 * independently — Punjab taxes by payment method, so a blended "average
 * rate" for a split bill is simply wrong, and rounding the whole bill
 * once then dividing it can drift the split total away from the correct
 * per-method figures by a paisa or two.
 */
export function calculateTax(basePaisa: Paisa | number, rateBp: number): Paisa {
  return Math.round((basePaisa * rateBp) / 10000) as Paisa;
}
