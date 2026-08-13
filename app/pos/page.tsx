"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import { useMenu, type MenuItem, type Modifier } from "@/lib/menu";
import { addItemsToOrder, type OrderType, type CartItem } from "@/lib/orders";
import { useOfflineAwarePlaceOrder } from "@/lib/offline-orders";
import { useOnlineStatus } from "@/lib/offline-network";
import { useShortcut } from "@/lib/shortcuts";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/lib/customers";
import type { TableWithStatus } from "@/lib/tables";

import { OrderTypePicker } from "@/components/pos/order-type-picker";
import { TablePicker } from "@/components/pos/table-picker";
import { DeliveryForm } from "@/components/pos/delivery-form";
import { ItemGrid, type SelectableItem } from "@/components/pos/item-grid";
import { ModifierSheet, type SelectedModifier } from "@/components/pos/modifier-sheet";
import { CartPanel, type CartLine, type ExistingLine } from "@/components/pos/cart-panel";
import { VoidOrderDialog } from "@/components/pos/void-order-dialog";
import { PendingPrintsIndicator } from "@/components/print/pending-prints-indicator";
import { OfflineIndicator } from "@/components/pos/offline-indicator";
import { AppShell } from "@/components/ui/AppShell";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;

/**
 * The cashier terminal — Part 16. The single number this screen is
 * built around: a mid-size order should take ~20 seconds to punch in,
 * not 90 — see docs/pos-terminal.md for the keyboard map and the
 * reasoning behind every shortcut below. Nothing here calculates a
 * price; every item/modifier shown is priced from `useMenu()` (Part 08),
 * and the server (place_order()/add_items_to_order(), Part 09)
 * re-derives the real total independently regardless of what this
 * screen displays.
 */
export default function PosPage() {
  const router = useRouter();
  const { staff, loading: staffLoading, lock } = useStaffSession("pos");
  const { day, loading: dayLoading, offline: dayOffline } = useBusinessDay(OUTLET_ID);
  const {
    categories,
    items,
    currentPrices,
    modifierGroups,
    modifiers,
    itemModifierGroups,
    loading: menuLoading,
    offline: menuOffline,
  } = useMenu(OUTLET_ID);
  const { state: placeState, submit: submitOrder, retry: retryOrder } = useOfflineAwarePlaceOrder(OUTLET_ID);
  const online = useOnlineStatus();
  const { showToast } = useToast();

  // ---- Order context: type, table, delivery customer ------------------
  const [orderType, setOrderType] = useState<OrderType | null>(null);
  const [table, setTable] = useState<TableWithStatus | null>(null);
  const [deliveryCustomer, setDeliveryCustomer] = useState<Customer | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState("");

  // ---- The order itself -------------------------------------------------
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [existingLines, setExistingLines] = useState<ExistingLine[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [lastSentCart, setLastSentCart] = useState<CartLine[] | null>(null);

  // ---- Keyboard-first order entry ---------------------------------------
  const [pendingQty, setPendingQty] = useState<number | null>(null);
  const [awaitingQtyDigit, setAwaitingQtyDigit] = useState(false);
  const [visibleItems, setVisibleItems] = useState<SelectableItem[]>([]);
  const visibleItemsRef = useRef(visibleItems);
  visibleItemsRef.current = visibleItems;

  const [modifierSheetItem, setModifierSheetItem] = useState<MenuItem | null>(null);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);

  const modifiersByGroup = useMemo(() => {
    const map = new Map<string, Modifier[]>();
    for (const m of modifiers) {
      const list = map.get(m.group_id) ?? [];
      list.push(m);
      map.set(m.group_id, list);
    }
    return map;
  }, [modifiers]);

  const dayOpen = day?.status === "open";
  const inCartBuilding = orderType !== null && (orderType !== "dine_in" || table !== null) && (orderType !== "delivery" || deliveryCustomer !== null);

  // ---- Loading existing order lines when resuming a table --------------
  const loadExistingLines = useCallback(async (orderId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("order_items")
      .select("id, name_snapshot, qty, line_total_paisa")
      .eq("order_id", orderId)
      .neq("status", "voided");
    setExistingLines((data as unknown as ExistingLine[]) ?? []);
  }, []);

  function pickTable(t: TableWithStatus) {
    setTable(t);
    if (t.openOrder) {
      setOpenOrderId(t.openOrder.id);
      loadExistingLines(t.openOrder.id);
    } else {
      setOpenOrderId(null);
      setExistingLines([]);
    }
  }

  function resetToStart() {
    setOrderType(null);
    setTable(null);
    setDeliveryCustomer(null);
    setDeliveryAddress("");
    setOpenOrderId(null);
    setExistingLines([]);
    setCart([]);
    setPendingQty(null);
  }

  // ---- Cart mutations -----------------------------------------------------
  function addToCart(item: MenuItem, mods: SelectedModifier[], note: string, qty: number) {
    const basePrice = currentPrices[item.id]?.price_paisa ?? 0;
    const modDelta = mods.reduce((s, m) => s + m.price_delta_paisa, 0);
    setCart((prev) => [
      ...prev,
      {
        lineId: crypto.randomUUID(),
        menuItemId: item.id,
        name: item.name,
        unitPricePaisa: basePrice + modDelta,
        qty,
        modifiers: mods,
        note: note || undefined,
      },
    ]);
  }

  function selectItem(item: MenuItem) {
    const qty = pendingQty ?? 1;
    setPendingQty(null);
    const groupIds = itemModifierGroups[item.id] ?? [];
    if (groupIds.length > 0) {
      setModifierSheetItem(item);
      // stash the pending qty on the item selection via closure below
      pendingQtyForSheet.current = qty;
    } else {
      addToCart(item, [], "", qty);
    }
  }
  const pendingQtyForSheet = useRef(1);

  function incrementLine(lineId: string) {
    setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty: l.qty + 1 } : l)));
  }
  function decrementLine(lineId: string) {
    setCart((prev) =>
      prev
        .map((l) => (l.lineId === lineId ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0)
    );
  }
  function removeLine(lineId: string) {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId));
  }

  function cartToOrderItems(lines: CartLine[]): CartItem[] {
    return lines.map((l) => ({
      menu_item_id: l.menuItemId,
      qty: l.qty,
      modifiers: l.modifiers.map((m) => ({
        modifier_id: m.modifier_id,
        price_delta_paisa: m.price_delta_paisa,
      })),
      note: l.note,
    }));
  }

  // ---- Sending -----------------------------------------------------------
  const [sendingExisting, setSendingExisting] = useState(false);
  const sending = placeState.status === "submitting" || sendingExisting;

  async function handleSend(goToSettleAfter = false) {
    if (cart.length === 0) {
      if (goToSettleAfter && openOrderId) router.push(`/pos/settle/${openOrderId}`);
      return;
    }
    const orderItems = cartToOrderItems(cart);

    try {
      if (openOrderId) {
        // add_items_to_order() has no idempotency-key protection (see
        // tests/orders.test.ts's own note on it) — queuing it offline
        // risks a genuine duplicate on retry, so this is the one action
        // in Part 20's offline design that's deliberately NOT queued.
        // See docs/offline-mode.md for the reasoning.
        if (!online) {
          showToast("No connection — can't add to an open table order offline. Wait to reconnect.", "error");
          return;
        }
        setSendingExisting(true);
        await addItemsToOrder(openOrderId, orderItems);
        setLastSentCart(cart);
        setCart([]);
        await loadExistingLines(openOrderId);
        showToast("Sent to kitchen", "success");
        if (goToSettleAfter) router.push(`/pos/settle/${openOrderId}`);
      } else {
        const result =
          placeState.status === "error"
            ? await retryOrder(orderType!, orderItems, {
                tableId: table?.id,
                customerId: deliveryCustomer?.id,
                note: orderType === "delivery" ? `Deliver to: ${deliveryAddress}` : undefined,
              })
            : await submitOrder(orderType!, orderItems, {
                tableId: table?.id,
                customerId: deliveryCustomer?.id,
                note: orderType === "delivery" ? `Deliver to: ${deliveryAddress}` : undefined,
              });
        if (!result) return;

        if (result.queued) {
          // No order id yet — it doesn't exist on the server until
          // synced. Stays on this screen (can't settle/print a receipt
          // for an order that isn't real yet) but clears the cart so
          // the cashier can move on to the next customer.
          setLastSentCart(cart);
          setCart([]);
          showToast("Offline — order queued, will send once reconnected", "error");
          if (orderType === "dine_in") resetToStart();
          return;
        }

        setOpenOrderId(result.order.id);
        setLastSentCart(cart);
        setCart([]);
        showToast(result.duplicate ? "Already sent" : "Sent to kitchen", "success");
        if (goToSettleAfter) {
          router.push(`/pos/settle/${result.order.id}`);
        } else if (orderType === "dine_in") {
          resetToStart();
        }
      }
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSendingExisting(false);
    }
  }

  // ---- Keyboard shortcuts (Part 16's signature element) ------------------
  useShortcut("pos-enter", "Enter", "Send order to kitchen", () => {
    if (inCartBuilding && !modifierSheetItem && !voidDialogOpen) handleSend(false);
  }, { allowWhileTyping: true });

  useShortcut("pos-f2", "F2", "Send & go straight to settlement", () => {
    if (inCartBuilding && !modifierSheetItem && !voidDialogOpen) handleSend(true);
  }, { allowWhileTyping: true });

  useShortcut("pos-f4", "F4", "Void this order", () => {
    if (openOrderId) setVoidDialogOpen(true);
  }, { allowWhileTyping: true });

  useShortcut("pos-esc", "Escape", "Clear the draft cart", () => {
    if (!modifierSheetItem && !voidDialogOpen) {
      setCart([]);
      setPendingQty(null);
      setAwaitingQtyDigit(false);
    }
  }, { allowWhileTyping: true });

  useShortcut("pos-repeat", "r", "Repeat last sent order", () => {
    if (lastSentCart && inCartBuilding) {
      setCart((prev) => [...prev, ...lastSentCart.map((l) => ({ ...l, lineId: crypto.randomUUID() }))]);
    }
  }, { ctrlKey: true, allowWhileTyping: true });

  // Digit keys (1-9 pick a visible item; after "*", the next digit sets
  // quantity) and "*" itself both need to work while the search input is
  // focused, but NOT type into it — handled here rather than through the
  // generic registry, since it's one stateful interaction, not a set of
  // independent shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!inCartBuilding || modifierSheetItem || voidDialogOpen) return;
      if (e.key === "*") {
        e.preventDefault();
        setAwaitingQtyDigit(true);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const n = Number(e.key);
        if (awaitingQtyDigit) {
          setPendingQty(n);
          setAwaitingQtyDigit(false);
          return;
        }
        const chosen = visibleItemsRef.current[n - 1];
        if (chosen) selectItem(chosen.item);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCartBuilding, modifierSheetItem, voidDialogOpen, awaitingQtyDigit, pendingQty, currentPrices, itemModifierGroups]);

  // ---- Render --------------------------------------------------------------
  if (staffLoading || dayLoading || menuLoading) {
    return <p className="p-8 text-portal-sm text-ink-500">Loading…</p>;
  }

  if (!dayOpen) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="text-terminal-lg text-ink-500">Day not open</p>
      </main>
    );
  }

  return (
    <AppShell density="terminal" staff={staff} dayStatus={dayOffline ? "open" : "open"} onLock={lock}>
      <div className="flex h-[calc(100vh-3rem)] flex-col">
        <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-1.5 text-portal-xs text-ink-500">
          <span>{table ? `Table ${table.label}` : orderType ? orderType.replace("_", " ") : "—"}</span>
          <span className="tabular-nums">{day.business_date}</span>
          <div className="flex items-center gap-2">
            <OfflineIndicator outletId={OUTLET_ID} />
            <PendingPrintsIndicator />
          </div>
        </div>
        {menuOffline && (
          <p className="border-b border-line bg-warning/10 px-4 py-1 text-portal-xs text-warning">
            Offline — showing the last synced menu. 86&apos;d items and price changes made elsewhere won&apos;t show
            until reconnected.
          </p>
        )}

        {!inCartBuilding ? (
        orderType === null ? (
          <OrderTypePicker onPick={setOrderType} />
        ) : orderType === "dine_in" ? (
          <TablePicker outletId={OUTLET_ID} onPick={pickTable} />
        ) : (
          <DeliveryForm
            outletId={OUTLET_ID}
            onReady={(customer, address) => {
              setDeliveryCustomer(customer);
              setDeliveryAddress(address);
            }}
          />
        )
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <ItemGrid
              categories={categories}
              items={items}
              currentPrices={currentPrices}
              onSelect={selectItem}
              onVisibleItemsChange={setVisibleItems}
            />
          </div>
          <div className="w-80 shrink-0">
            <CartPanel
              existingLines={existingLines}
              cart={cart}
              pendingQty={pendingQty}
              onIncrement={incrementLine}
              onDecrement={decrementLine}
              onRemove={removeLine}
              onSend={() => handleSend(false)}
              sending={sending}
              sendLabel={openOrderId ? "Send more" : "Send order"}
              canSend={cart.length > 0}
            />
          </div>
        </div>
        )}
      </div>

      {modifierSheetItem && (
        <ModifierSheet
          item={modifierSheetItem}
          groups={modifierGroups.filter((g) => (itemModifierGroups[modifierSheetItem.id] ?? []).includes(g.id))}
          modifiersByGroup={modifiersByGroup}
          onClose={() => setModifierSheetItem(null)}
          onConfirm={(selected, note) => {
            addToCart(modifierSheetItem, selected, note, pendingQtyForSheet.current);
            setModifierSheetItem(null);
          }}
        />
      )}

      {voidDialogOpen && openOrderId && (
        <VoidOrderDialog
          orderId={openOrderId}
          currentRole={staff?.role}
          onClose={() => setVoidDialogOpen(false)}
          onVoided={() => {
            setVoidDialogOpen(false);
            showToast("Order voided", "success");
            resetToStart();
          }}
        />
      )}
    </AppShell>
  );
}
