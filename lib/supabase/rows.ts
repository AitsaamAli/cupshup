/**
 * `lib/types.ts`'s Database placeholder types every row as `any`, which
 * makes a direct `data as SomeType[]` cast fail TypeScript's
 * "insufficient overlap" check on the array shape supabase-js infers
 * from it. Routing through `unknown` first is safe here — that's
 * genuinely what a raw Postgrest response is until `npm run db:types`
 * generates real types — and this helper avoids repeating that dance at
 * every call site across the app.
 */
export function castRows<T>(data: unknown): T[] {
  return (data as T[] | null) ?? [];
}
