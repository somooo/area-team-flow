import { describe, expect, it } from "vitest";
import { normalizeBadge, planVacationImport, type DirectoryStaffLite } from "@/lib/vacation-io";

const staff: DirectoryStaffLite[] = [
  { id: "s1", email: "a@h.com", name: "Adel Al Harbi", role: "staff", area: "Wards", badge_id: "044707" },
  { id: "s2", email: "b@h.com", name: "Adornado Cadungog", role: "staff", area: "Wards", badge_id: 902682 as unknown as string },
  { id: "s3", email: "c@h.com", name: "Icu Person", role: "staff", area: "ICU", badge_id: "102343" },
];

const plan = (rows: Record<string, unknown>[], opts: Partial<Parameters<typeof planVacationImport>[0]> = {}) =>
  planVacationImport({ rows, area: "Wards", staff, existing: [], ...opts });

describe("badge normalisation", () => {
  it("collapses formatting and leading zeros", () => {
    expect(normalizeBadge(" 0-44 707 ")).toBe("44707");
    expect(normalizeBadge(902682)).toBe("902682");
    expect(normalizeBadge("")).toBe("");
  });
});

describe("planVacationImport", () => {
  it("matches by badge and takes name/area from the directory, not the file", () => {
    const [r] = plan([{ Badge: "44707", "Staff Name": "adel alharbi", Area: "ICU", "Vacation Start": "2026-08-15", "Vacation End": "2026-08-20" }]);
    expect(r.status).toBe("add");
    expect(r.label).toBe("Adel Al Harbi");
    expect(r.area).toBe("Wards");
    expect(r.warning).toContain("directory says");
    expect(r.payload!.start_date).toBe("2026-08-15");
    expect(r.payload!.status).toBe("Approved");
  });

  it("handles aliases, numeric badges and ranges crossing into the next year", () => {
    const [r] = plan([{ "Badge No": 902682, From: "20/12/2026", To: "14/01/2027" }]);
    expect(r.status).toBe("add");
    expect(r.payload!.start_date).toBe("2026-12-20");
    expect(r.payload!.end_date).toBe("2027-01-14");
  });

  it("skips missing badge, unknown badge, other areas and reversed dates", () => {
    const rows = [
      { Badge: "", "Vacation Start": "2026-08-01", "Vacation End": "2026-08-02" },
      { Badge: "999999", "Vacation Start": "2026-08-01", "Vacation End": "2026-08-02" },
      { Badge: "102343", "Vacation Start": "2026-08-01", "Vacation End": "2026-08-02" },
      { Badge: "44707", "Vacation Start": "2026-08-09", "Vacation End": "2026-08-02" },
    ];
    expect(plan(rows).map((r) => r.reason)).toEqual([
      "Missing badge",
      "Badge 999999 not found in staff directory",
      "Different area (ICU)",
      "End before start",
    ]);
  });

  it("imports other areas when allAreas is set", () => {
    const [r] = plan([{ Badge: "102343", "Vacation Start": "2026-08-01", "Vacation End": "2026-08-02" }], { allAreas: true });
    expect(r.status).toBe("add");
    expect(r.payload!.area).toBe("ICU");
  });

  it("keeps repeated badges with different ranges and detects no-change rows", () => {
    const rows = [
      { Badge: "44707", "Vacation Start": "2026-08-01", "Vacation End": "2026-08-05" },
      { Badge: "44707", "Vacation Start": "2026-10-01", "Vacation End": "2026-10-05" },
    ];
    const existing = [{ id: "L1", staff_id: "s1", staff_email: "a@h.com", start_date: "2026-08-01", end_date: "2026-08-05", status: "Approved" }];
    const out = plan(rows, { existing });
    expect(out[0].reason).toBe("No change (already imported)");
    expect(out[1].status).toBe("add");
  });

  it("updates when only the status differs and warns on overlaps", () => {
    const existing = [{ id: "L1", staff_id: "s1", staff_email: "a@h.com", start_date: "2026-08-01", end_date: "2026-08-05", status: "Pending" }];
    const out = plan([
      { Badge: "44707", "Vacation Start": "2026-08-01", "Vacation End": "2026-08-05", Status: "approved" },
      { Badge: "44707", "Vacation Start": "2026-08-04", "Vacation End": "2026-08-09" },
    ], { existing });
    expect(out[0].status).toBe("update");
    expect(out[0].payload!.existing_id).toBe("L1");
    expect(out[1].warning).toContain("Overlaps existing leave");
  });
});
