"use client";

import { useMemo, useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import { useMenu } from "@/lib/menu";
import { useIngredients, useRecipe, upsertRecipeLine, removeRecipeLine } from "@/lib/inventory";
import { formatPaisa, type Paisa } from "@/lib/money";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_EDIT = new Set(["owner", "manager", "chef"]);

const PORTAL_NAV = [
  { label: "Dashboard", href: "/reports/dashboard" },
  { label: "Master P&L", href: "/reports/pl" },
  { label: "Menu", href: "/manage/menu" },
  { label: "Inventory", href: "/manage/inventory" },
  { label: "Purchases", href: "/manage/purchases" },
  { label: "Expenses", href: "/manage/expenses" },
  { label: "Business day", href: "/manage/day" },
  { label: "House accounts", href: "/manage/house-accounts" },
];

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
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
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

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Inventory" }, { label: "Recipes" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <h1 className="mb-4 text-portal-xl font-semibold text-ink-900">Recipes</h1>

        <div className="flex gap-6">
          <nav className="w-64 shrink-0 space-y-4">
            {categories.map((cat) => (
              <div key={cat.id}>
                <p className="mb-1 text-portal-xs font-medium uppercase tracking-wide text-ink-500">{cat.name}</p>
                {items
                  .filter((i) => i.category_id === cat.id && i.active)
                  .map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItemId(item.id)}
                      className={`block w-full rounded-md px-2 py-1 text-left text-portal-sm transition-colors duration-[120ms] ease-out ${
                        item.id === selectedItemId ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-canvas"
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
              <p className="text-portal-sm text-ink-500">Pick a menu item to edit its recipe.</p>
            ) : (
              <Card className="p-4">
                <h2 className="mb-1 text-portal-lg font-semibold text-ink-900">{selectedItem.name}</h2>
                <div className="mb-4 flex gap-6 text-portal-sm text-ink-500">
                  <span>Price: {formatPaisa(priceForSelected as Paisa)}</span>
                  <span>Recipe cost: {formatPaisa(recipeCostPaisa as Paisa)}</span>
                  <span className={marginPct !== null && marginPct < 20 ? "text-warning" : ""}>
                    Margin: {marginPct === null ? "—" : `${marginPct}%`}
                  </span>
                </div>

                <ul className="mb-4 space-y-2">
                  {lines.map((line) => {
                    const ing = ingredientById.get(line.ingredient_id);
                    return (
                      <li
                        key={line.ingredient_id}
                        className="flex items-center justify-between rounded-md border border-line p-2 text-portal-sm"
                      >
                        <span className="text-ink-900">{ing?.name ?? line.ingredient_id}</span>
                        <span className="text-ink-500">
                          {line.qty} {ing?.unit}
                        </span>
                        {canEdit && (
                          <Button
                            variant="quiet"
                            className="text-danger hover:text-danger"
                            onClick={async () => {
                              await removeRecipeLine(selectedItem.id, line.ingredient_id);
                              reload();
                            }}
                          >
                            Remove
                          </Button>
                        )}
                      </li>
                    );
                  })}
                  {lines.length === 0 && (
                    <p className="text-portal-sm text-ink-500">
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
              </Card>
            )}
          </section>
        </div>
      </div>
    </AppShell>
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
      <Field label="Ingredient" htmlFor="recipe-ingredient">
        <Select id="recipe-ingredient" value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
          <option value="">Select…</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Qty" htmlFor="recipe-qty">
        <Input
          id="recipe-qty"
          type="number"
          step="0.001"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-24"
        />
      </Field>
      <Button variant="primary" onClick={add}>
        Add
      </Button>
      {error && <p className="text-portal-sm text-danger">{error}</p>}
    </div>
  );
}
