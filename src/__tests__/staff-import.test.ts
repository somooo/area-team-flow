import { describe, expect, it } from "vitest";
import { isProtectedTest, normalizeBadge, parseHireDate, readStaffRows } from "@/lib/staff-import";

describe("parseHireDate", () => {
  it("keeps a real Excel date without transposing day and month", () => {
    expect(parseHireDate(new Date(Date.UTC(2023, 8, 12))).date).toBe("2023-09-12");
    expect(parseHireDate(new Date(Date.UTC(2020, 3, 1))).date).toBe("2020-04-01");
  });
  it("reads day-first text dates", () => {
    expect(parseHireDate("09/07/2024").date).toBe("2024-07-09");
    expect(parseHireDate("2023-09-12").date).toBe("2023-09-12");
  });
  it("reads month-name text like 16 Oct'19", () => {
    expect(parseHireDate("16 Oct'19").date).toBe("2019-10-16");
  });
  it("warns instead of failing on junk", () => {
    const r = parseHireDate("not a date");
    expect(r.date).toBeNull();
    expect(r.warning).toBeTruthy();
  });
});

describe("normalizeBadge", () => {
  it("strips zeros and non-digits", () => {
    expect(normalizeBadge("0052567")).toBe("52567");
    expect(normalizeBadge(3904364)).toBe("3904364");
  });
});

describe("isProtectedTest", () => {
  it("matches names starting with Test", () => {
    expect(isProtectedTest({ name: "  test user" })).toBe(true);
    expect(isProtectedTest({ name: "Ahmed", first_name: "Testing" })).toBe(true);
    expect(isProtectedTest({ name: "Contest Ali" })).toBe(false);
  });
});

describe("readStaffRows", () => {
  it("reads every data row of the sheet", () => {
    const header = ["Full Name", "BADGE", "Date of Hire"];
    const body = Array.from({ length: 172 }, (_, i) => [`Staff ${i}`, 100000 + i, new Date(Date.UTC(2020, 0, 5))]);
    const { rows } = readStaffRows({ sheetNames: ["Sheet1"], sheets: { Sheet1: [header, ...body] } });
    expect(rows).toHaveLength(172);
  });
});
