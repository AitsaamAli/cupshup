/**
 * Supabase-generated database types.
 *
 * This file is a PLACEHOLDER. Once the project is linked to a real
 * Supabase project, regenerate it for real by running:
 *
 *   npm run db:types
 *
 * which runs:
 *
 *   npx supabase gen types typescript --linked > lib/types.ts
 *
 * That command reads your live (or linked) Postgres schema and writes exact
 * TypeScript types for every table, view, enum, and RPC function — so a call
 * like `supabase.from('orders').select()` is fully typed, and a typo in a
 * column name fails at compile time instead of silently returning
 * `undefined` at 2am during service. Run it again any time the schema
 * changes (new migration).
 *
 * Until then, `Database` is deliberately LOOSE rather than empty: each
 * table/view/function accepts `any` shape instead of `never`, so real code
 * (lib/supabase/*.ts, app/api/**) can call `.from('staff')`,
 * `.rpc('verify_staff_pin', ...)` etc. and compile — just without the
 * column-name-typo protection the real generated file gives you. Treat any
 * `Row`/`Args` shape you see used elsewhere in the app as informal
 * documentation, not a compiler guarantee, until `npm run db:types` runs.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseTable = { Row: any; Insert: any; Update: any; Relationships: never[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseFunction = { Args: any; Returns: any };

export type Database = {
  public: {
    Tables: Record<string, LooseTable>;
    Views: Record<string, { Row: LooseTable["Row"]; Relationships: never[] }>;
    Functions: Record<string, LooseFunction>;
    Enums: Record<string, string>;
  };
};
