"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import type { MenuItem, ModifierGroup, Modifier } from "@/lib/menu";
import type { Paisa } from "@/lib/money";

export interface SelectedModifier {
  modifier_id: string;
  name: string;
  price_delta_paisa: number;
}

/**
 * The modifier sheet — Part 16 ("item par tap → modifier sheet"). Each
 * group enforces its own min/max_select (Part 08's schema): a group
 * with max_select=1 renders as radio buttons, anything else as
 * checkboxes capped at max_select. Confirm is disabled until every
 * group's min_select is satisfied — the same rule place_order() doesn't
 * itself enforce (modifiers are free-form jsonb there), so getting it
 * right here is what actually keeps an order sane before it's sent.
 */
export function ModifierSheet({
  item,
  groups,
  modifiersByGroup,
  onClose,
  onConfirm,
}: {
  item: MenuItem;
  groups: ModifierGroup[];
  modifiersByGroup: Map<string, Modifier[]>;
  onClose: () => void;
  onConfirm: (selected: SelectedModifier[], note: string) => void;
}) {
  const [selectedByGroup, setSelectedByGroup] = useState<Map<string, Set<string>>>(new Map());
  const [note, setNote] = useState("");

  function toggle(group: ModifierGroup, modifierId: string) {
    setSelectedByGroup((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(group.id) ?? []);
      if (current.has(modifierId)) {
        current.delete(modifierId);
      } else {
        if (group.max_select === 1) current.clear();
        else if (current.size >= group.max_select) return prev; // at cap, ignore
        current.add(modifierId);
      }
      next.set(group.id, current);
      return next;
    });
  }

  const allSatisfied = useMemo(
    () => groups.every((g) => (selectedByGroup.get(g.id)?.size ?? 0) >= g.min_select),
    [groups, selectedByGroup]
  );

  function confirm() {
    if (!allSatisfied) return;
    const selected: SelectedModifier[] = [];
    for (const group of groups) {
      const ids = selectedByGroup.get(group.id) ?? new Set();
      const options = modifiersByGroup.get(group.id) ?? [];
      for (const id of ids) {
        const mod = options.find((m) => m.id === id);
        if (mod) selected.push({ modifier_id: mod.id, name: mod.name, price_delta_paisa: mod.price_delta_paisa });
      }
    }
    onConfirm(selected, note.trim());
  }

  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto">
        {groups.map((group) => {
          const options = modifiersByGroup.get(group.id) ?? [];
          const selected = selectedByGroup.get(group.id) ?? new Set();
          return (
            <fieldset key={group.id}>
              <legend className="mb-1 text-xs text-neutral-400">
                {group.name}
                {group.min_select > 0 && <span className="text-amber-400"> (required)</span>}
              </legend>
              <div className="space-y-1">
                {options.map((mod) => (
                  <label
                    key={mod.id}
                    className="flex min-h-11 cursor-pointer items-center justify-between rounded-md border border-neutral-800 px-3 py-2 text-sm hover:border-neutral-600"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type={group.max_select === 1 ? "radio" : "checkbox"}
                        name={group.id}
                        checked={selected.has(mod.id)}
                        onChange={() => toggle(group, mod.id)}
                        className="h-4 w-4"
                      />
                      {mod.name}
                    </span>
                    {mod.price_delta_paisa !== 0 && (
                      <Money paisa={mod.price_delta_paisa as Paisa} className="text-neutral-400" />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="e.g. less spicy" />
        </label>
      </div>

      <Button variant="primary" className="mt-4 w-full" disabled={!allSatisfied} onClick={confirm}>
        Add to order
      </Button>
    </Modal>
  );
}
