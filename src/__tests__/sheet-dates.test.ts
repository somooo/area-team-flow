import { describe, expect, it } from "vitest";
import { detectSheetLayout, planSheetImport } from "@/lib/sheet-schedule-import";
import { readDateParts, toISODateValue } from "@/lib/xlsx-io";
import type { StaffLite } from "@/components/MonthGrid";

const augHeader = (make: (d: number) => unknown) => [
  "Name", "Badge", ...Array.from({ length: 31 }, (_, i) => make(i + 1)),
];

describe("readDateParts", () => {
  it("keeps the real month for local-midnight and UTC-midnight dates", () => {
    expect(toISODateValue(new Date(2026, 7, 31))).toBe("2026-08-31");
    expect(toISODateValue(new Date(Date.UTC(2026, 7, 1)))).toBe("2026-08-01");
    expect(readDateParts("2026-08-31")).toEqual({ year: 2026, month: 8, day: 31 });
  });
});

describe("detectSheetLayout dates", () => {
  for (const [label, make] of [
    ["date cells", (d: number) => new Date(2026, 7, d)],
    ["utc date cells", (d: number) => new Date(Date.UTC(2026, 7, d))],
    ["iso text", (d: number) => `2026-08-${String(d).padStart(2, "0")}`],
  ] as const) {
    it(`reads August 2026 from ${label}`, () => {
      const l = detectSheetLayout([augHeader(make), ["A", "1"]], "Day", "day");
      expect(l.month).toBe(8);
      expect(l.year).toBe(2026);
      expect(l.dateCols).toHaveLength(31);
      expect(l.firstDate).toBe("2026-08-01");
      expect(l.lastDate).toBe("2026-08-31");
      expect(l.outOfMonth).toHaveLength(0);
    });
  }

  it("ignores trailing empty columns", () => {
    const l = detectSheetLayout([[...augHeader((d) => new Date(2026, 7, d)), "", "", ""], []], "Day", "day");
    expect(l.dateCols).toHaveLength(31);
  });
});

describe("planSheetImport date safety", () => {
  const staff: StaffLite[] = [];
  const directory = [{ id: "1", name: "A", email: "a@b.c", badge: "5", area: "ICU" }] as never[];

  it("aborts when a header date lands outside the detected month", () => {
    const header = augHeader((d) => new Date(2026, 7, d));
    header[2] = new Date(2026, 6, 31); // stray July column
    const matrix = [header, ["A", "5", ...Array.from({ length: 31 }, () => "A3")]];
    const layout = detectSheetLayout(matrix, "Day", "day");
    expect(() =>
      planSheetImport({ sources: [{ side: "day", matrix, layout }], staff, directory, shifts: [], replace: true }),
    ).toThrow(/Date check failed/);
  });

  it("writes 1 and 31 August without slipping into July or September", () => {
    const matrix = [
      augHeader((d) => new Date(2026, 7, d)),
      ["A", "5", ...Array.from({ length: 31 }, () => "A3")],
    ];
    const layout = detectSheetLayout(matrix, "Day", "day");
    const res = planSheetImport({ sources: [{ side: "day", matrix, layout }], staff, directory, shifts: [], replace: true });
    const dates = res.items.map((i) => i.payload!.date);
    expect(dates).toHaveLength(31);
    expect(dates[0]).toBe("2026-08-01");
    expect(dates[30]).toBe("2026-08-31");
    expect(dates.every((d) => d.startsWith("2026-08-"))).toBe(true);
    expect(res.range).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });
});
