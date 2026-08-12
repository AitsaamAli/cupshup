"use client";

import { useMemo, useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useMenu } from "@/lib/menu";
import { useIngredients, useRecipe, upsertRecipeLine, removeRecipeLine } from "@/lib/inventory";
import { formatPaisa, type Paisa } from "@/lib/money";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_EDIT = new Set(["owner", "manager", "chef"]);

/**
 * Recipe editor — Part 11. Sets what each menu item is actually made
 * of, which is what makes cogs_paisa (and therefore every margin figure
 * in this app, all the way up to Master P&L) a real number instead of a
 * guessed flat percentage. Cost and margin here are computed the exact
 * same way place_order()/settle_order() compute them server-side
 * (sum of qty × ingredient's moving_avg_cost_paisa) — this screen just
 * shows the arithmetic before it happens, not a separate estimate.
 */
export default function RecipesPage() {
  const { staff } = useStaffSession("manage");
  const { categories, items, currentPrices } = useMenu(OUTLET_ID);
  const ingredients = useIngredients(OUTLET_ID);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const { lines, reload } = useRecipe(selectedItemId);

  const canEdit = !!staff && CAN_EDIT.has(staff.role);
  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;

  const ingredientById = useMemo(() => {
    const map = new Map(ingredients.map((i) => [i.id, i]));
    return map;
  }, [ingredients]);

  const recipeCostPaisa = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const ing = ingredientById.get(line.ingredient_id);
        if (!ing) return sum;
        return sum + Math.round(line.qty * ing.moving_avg_cost_paisa);
      }, 0),
    [lines, ingredientById]
  );

  const priceForSelected = selectedItemId ? currentPrices[selectedItemId]?.price_paisa ?? 0 : 0;
  const marginPct =
    priceForSelected > 0 ? Math.round(((priceForSelected - recipeCostPaisa) / priceForSelected) * 100) : null;

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <h1 className="mb-6 text-xl font-semibold">Recipes</h1>

      <div className="flex gap-6">
        <nav className="w-64 shrink-0 space-y-4">
          {categories.map((cat) => (
            <div key={cat.id}>
              <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">{cat.name}</p>
              {items
                .filter((i) => i.category_id === cat.id && i.active)
                .map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItemId(item.id)}
                    className={`block w-full rounded-md px-2 py-1 text-left text-sm ${
                      item.id === selectedItemId
                        ? "bg-white text-neutral-950"
                        : "text-neutral-300 hover:bg-neutral-900"
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <section className="flex-1">
          {!selectedItem ? (
            <p className="text-neutral-500">Pick a menu item to edit its recipe.</p>
          ) : (
            <>
              <h2 className="mb-1 text-lg font-medium">{selectedItem.name}</h2>
              <div className="mb-4 flex gap-6 text-sm text-neutral-400">
                <span>Price: {formatPaisa(priceForSelected as Paisa)}</span>
                <span>Recipe cost: {formatPaisa(recipeCostPaisa as Paisa)}</span>
                <span className={marginPct !== null && marginPct < 20 ? "text-amber-400" : ""}>
                  Margin: {marginPct === null ? "—" : `${marginPct}%`}
                </span>
              </div>

              <ul className="mb-4 space-y-2">
                {lines.map((line) => {
                  const ing = ingredientById.get(line.ingredient_id);
                  return (
                    <li
                      key={line.ingredient_id}
                      className="flex items-center justify-between rounded-md border border-neutral-800 p-2 text-sm"
                    >
                      <span>{ing?.name ?? line.ingredient_id}</span>
                      <span className="text-neutral-400">
                        {line.qty} {ing?.unit}
                      </span>
                      {canEdit && (
                        <button
                          onClick={async () => {
                            await removeRecipeLine(selectedItem.id, line.ingredient_id);
                            reload();
                          }}
                          className="text-red-400 underline"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  );
                })}
                {lines.length === 0 && (
                  <p className="text-sm text-neutral-500">
                    No recipe set yet — this item&apos;s cost is currently Rs 0 and its true margin
                    is unknown.
                  </p>
                )}
              </ul>

              {canEdit && (
                <AddRecipeLine
                  ingredients={ingredients.filter(
                    (i) => !lines.some((l) => l.ingredient_id === i.id)
                  )}
                  onAdd={async (ingredientId, qty) => {
                    await upsertRecipeLine(selectedItem.id, ingredientId, qty);
                    reload();
                  }}
                />
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function AddRecipeLine({
  ingredients,
  onAdd,
}: {
  ingredients: { id: string; name: string; unit: string }[];
  onAdd: (ingredientId: string, qty: number) => Promise<void>;
}) {
  const [ingredientId, setIngredientId] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const n = Number(qty);
    if (!ingredientId || !Number.isFinite(n) || n <= 0) {
      setError("Pick an ingredient and a quantity > 0.");
      return;
    }
    setError(null);
    await onAdd(ingredientId, n);
    setIngredientId("");
    setQty("");
  }

  return (
    <div className="flex items-end gap-2">
      <label className="block">
        <span className="mb-1 block text-xs text-neutral-400">Ingredient</span>
        <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} className="input">
          <option value="">Select…</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-neutral-400">Qty</span>
        <input
          type="number"
          step="0.001"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="input w-24"
        />
      </label>
      <button onClick={add} className="rounded-md bg-white px-3 py-2 text-sm font-medium text-neutral-950">
        Add
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
