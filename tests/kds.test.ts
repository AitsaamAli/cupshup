import { describe, it, expect } from "vitest";
import {
  ticketAgeLevel,
  ticketAgeMinutes,
  ticketItemsForStation,
  ticketMatchesStation,
  averageTicketMinutes,
  averageMinutesByStation,
  averageMinutesByHour,
  minutesBetween,
  type KdsOrderItem,
} from "../lib/kds";

describe("ticketAgeLevel — Part 17's 0-5/5-10/10+ colour thresholds", () => {
  it("under 5 minutes is neutral", () => {
    expect(ticketAgeLevel(0)).toBe("neutral");
    expect(ticketAgeLevel(4.9)).toBe("neutral");
  });

  it("5 up to 10 minutes is warning (amber)", () => {
    expect(ticketAgeLevel(5)).toBe("warning");
    expect(ticketAgeLevel(9.9)).toBe("warning");
  });

  it("10 minutes or more is danger (red)", () => {
    expect(ticketAgeLevel(10)).toBe("danger");
    expect(ticketAgeLevel(45)).toBe("danger");
  });
});

describe("ticketAgeMinutes", () => {
  it("computes elapsed minutes against a fixed 'now'", () => {
    const createdAt = "2026-08-12T20:00:00.000Z";
    const now = new Date("2026-08-12T20:07:30.000Z");
    expect(ticketAgeMinutes(createdAt, now)).toBeCloseTo(7.5, 5);
  });
});

function item(overrides: Partial<KdsOrderItem>): KdsOrderItem {
  return {
    id: "item-1",
    order_id: "order-1",
    menu_item_id: "menu-1",
    name_snapshot: "Karak Chai",
    qty: 1,
    modifiers: [],
    note: null,
    status: "pending",
    created_at: "2026-08-12T20:00:00.000Z",
    ready_at: null,
    station: "chai_coffee",
    ...overrides,
  };
}

describe("ticketItemsForStation / ticketMatchesStation — Part 17's station filtering", () => {
  it("a specific station only sees its own items", () => {
    const items = [item({ id: "a", station: "hot_kitchen" }), item({ id: "b", station: "chai_coffee" })];
    const forChai = ticketItemsForStation(items, "chai_coffee");
    expect(forChai.map((i) => i.id)).toEqual(["b"]);
  });

  it("an item with no resolvable station is visible on every station", () => {
    const items = [item({ id: "a", station: null })];
    expect(ticketItemsForStation(items, "hot_kitchen")).toHaveLength(1);
    expect(ticketItemsForStation(items, "bakery")).toHaveLength(1);
  });

  it("null station means 'All stations' — every item", () => {
    const items = [item({ id: "a", station: "hot_kitchen" }), item({ id: "b", station: "bakery" })];
    expect(ticketItemsForStation(items, null)).toHaveLength(2);
  });

  it("a ticket with nothing for this station doesn't match it", () => {
    const items = [item({ id: "a", station: "hot_kitchen" })];
    expect(ticketMatchesStation(items, "bakery")).toBe(false);
    expect(ticketMatchesStation(items, "hot_kitchen")).toBe(true);
  });
});

describe("minutesBetween / averageTicketMinutes", () => {
  it("computes minutes between two ISO timestamps", () => {
    expect(minutesBetween("2026-08-12T20:00:00.000Z", "2026-08-12T20:12:00.000Z")).toBeCloseTo(12, 5);
  });

  it("averages only samples that have a readyAt, ignoring unfinished tickets", () => {
    const samples = [
      { createdAt: "2026-08-12T20:00:00.000Z", readyAt: "2026-08-12T20:10:00.000Z" }, // 10 min
      { createdAt: "2026-08-12T20:00:00.000Z", readyAt: "2026-08-12T20:20:00.000Z" }, // 20 min
      { createdAt: "2026-08-12T20:00:00.000Z", readyAt: null }, // still cooking — excluded
    ];
    expect(averageTicketMinutes(samples)).toBe(15);
  });

  it("returns null when nothing has finished yet", () => {
    expect(averageTicketMinutes([{ createdAt: "2026-08-12T20:00:00.000Z", readyAt: null }])).toBeNull();
  });
});

describe("averageMinutesByStation", () => {
  it("groups by station and leaves untouched stations null, not zero", () => {
    const samples = [
      { createdAt: "2026-08-12T20:00:00.000Z", readyAt: "2026-08-12T20:06:00.000Z", station: "hot_kitchen" as const },
      { createdAt: "2026-08-12T20:00:00.000Z", readyAt: "2026-08-12T20:04:00.000Z", station: "hot_kitchen" as const },
      { createdAt: "2026-08-12T20:00:00.000Z", readyAt: "2026-08-12T20:02:00.000Z", station: "chai_coffee" as const },
    ];
    const result = averageMinutesByStation(samples);
    expect(result.hot_kitchen).toBe(5);
    expect(result.chai_coffee).toBe(2);
    expect(result.cold_bar).toBeNull();
    expect(result.bakery).toBeNull();
  });
});

describe("averageMinutesByHour", () => {
  it("buckets by the local hour the ticket was created", () => {
    const hour = new Date("2026-08-12T20:00:00.000Z").getHours();
    const samples = [
      { createdAt: "2026-08-12T20:00:00.000Z", readyAt: "2026-08-12T20:08:00.000Z" }, // 8 min
    ];
    const result = averageMinutesByHour(samples);
    expect(result[hour]).toBe(8);
  });
});
