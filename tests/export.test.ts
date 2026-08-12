import { describe, it, expect } from "vitest";
import { toCsv } from "../lib/export";

describe("toCsv", () => {
  it("writes a header row followed by one row per record, in column order", () => {
    const csv = toCsv([{ a: 1, b: "x" }, { a: 2, b: "y" }], ["a", "b"]);
    expect(csv).toBe("a,b\r\n1,x\r\n2,y");
  });

  it("quotes and escapes a value containing a comma", () => {
    const csv = toCsv([{ name: "Ali, Karak Chai" }], ["name"]);
    expect(csv).toBe('name\r\n"Ali, Karak Chai"');
  });

  it("doubles internal quotes when a value itself contains a quote", () => {
    const csv = toCsv([{ note: 'said "hello"' }], ["note"]);
    expect(csv).toBe('note\r\n"said ""hello"""');
  });

  it("renders null/undefined as an empty field, not the literal string", () => {
    const csv = toCsv([{ vendor: null as string | null }], ["vendor"]);
    expect(csv).toBe("vendor\r\n");
  });
});
