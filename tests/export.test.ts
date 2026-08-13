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

  // Formula-injection guard — a free-text field (e.g. an expense vendor
  // name) that starts with =, +, -, or @ would otherwise be read as a
  // live formula by Excel/Sheets when the accountant opens the export.
  it.each(["=cmd|'/c calc'!A1", "+1+1", "-1+1", "@SUM(A1:A9)"])(
    "prefixes a leading apostrophe when a value starts with %s",
    (dangerous) => {
      const csv = toCsv([{ vendor: dangerous }], ["vendor"]);
      expect(csv).toBe(`vendor\r\n'${dangerous}`);
    },
  );

  it("leaves a value with = in the middle, not the start, untouched", () => {
    const csv = toCsv([{ note: "qty=5" }], ["note"]);
    expect(csv).toBe("note\r\nqty=5");
  });

  it("still applies comma/quote escaping after the formula-injection prefix", () => {
    const csv = toCsv([{ vendor: '=cmd,"boom"' }], ["vendor"]);
    expect(csv).toBe(`vendor\r\n"'=cmd,""boom"""`);
  });
});
