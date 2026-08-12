import { describe, it, expect } from "vitest";
import { deriveTableStatus } from "../lib/tables";

describe("deriveTableStatus — Part 16's table-grid states", () => {
  it("no order at all means the table is empty", () => {
    expect(deriveTableStatus(null)).toBe("empty");
    expect(deriveTableStatus(undefined)).toBe("empty");
  });

  it("sent_to_kitchen or ready means the table is being served", () => {
    expect(deriveTableStatus("sent_to_kitchen")).toBe("running");
    expect(deriveTableStatus("ready")).toBe("running");
  });

  it("served (kitchen done, not yet paid) means the bill is wanted", () => {
    expect(deriveTableStatus("served")).toBe("bill_requested");
  });
});
