import { supabase } from "@/integrations/supabase/client";
import type { ImportItem } from "@/components/ExcelImportButton";
import { downloadSheet, field, toISODateValue } from "@/lib/xlsx-io";
import { countVacationDays } from "@/lib/hours-model";
import type { AppRole } from "@/lib/permissions";
import { UNASSIGNED_AREA } from "@/lib/areas";

export type VacationRow = {
  id: string;
  staff_email: string;
  staff_name: string;
  area: string;
  start_date: string;
  end_date: string;
  status: string;
  approver_email: string | null;
  created_at: string;
};

export type DirectoryStaffLite = {
  id: string; email: string; name: string; role: AppRole; area: string | null; badge_id?: string | null;
};

/** Export the selected area's vacation rows for one calendar year. */
export async function exportVacationsExcel(area: string, year: number) {
  const [{ data: leaves }, { data: staff }] = await Promise.all([
    supabase.from("leave_requests")
      .select("id,staff_email,staff_name,area,start_date,end_date,status,approver_email,created_at")
      .eq("area", area).eq("leave_type", "Vacation")
      .lte("start_date", `${year}-12-31`).gte("end_date", `${year}-01-01`)
      .order("start_date"),
    supabase.from("staff").select("email,name,role,badge_id"),
  ]);
  const nameByEmail = new Map<string, string>();
  const roleByEmail = new Map<string, AppRole>();
  const badgeByEmail = new Map<string, string>();
  for (const s of (staff as { email: string; name: string; role: AppRole; badge_id: string | null }[]) ?? []) {
    nameByEmail.set(s.email.toLowerCase(), s.name);
    roleByEmail.set(s.email.toLowerCase(), s.role);
    if (s.badge_id) badgeByEmail.set(s.email.toLowerCase(), String(s.badge_id));
  }
  const header = ["Badge", "Staff Name", "Area", "Vacation Start", "Vacation End", "Days", "Status", "Requested On", "Approved By"];
  const body = ((leaves as VacationRow[]) ?? []).map((r) => [
    badgeByEmail.get(r.staff_email.toLowerCase()) ?? "",
    r.staff_name,
    r.area,
    r.start_date,
    r.end_date,
    countVacationDays(r.start_date, r.end_date, roleByEmail.get(r.staff_email.toLowerCase()) ?? "staff"),
    r.status,
    r.created_at ? r.created_at.slice(0, 10) : "",
    r.approver_email ? (nameByEmail.get(r.approver_email.toLowerCase()) ?? r.approver_email) : "",
  ]);
  downloadSheet(`vacations_${area}_${year}.xlsx`, `${area} ${year}`, [header, ...body], [12, 24, 14, 14, 14, 8, 12, 14, 22]);
  return body.length;
}

export type VacationImportPayload = {
  /** Existing leave_requests id when this row is an update. */
  existing_id?: string;
  badge: string;
  staff_id: string; staff_email: string; staff_name: string; area: string;
  start_date: string; end_date: string; status: string;
  /** Row exceeds the area's daily cap and is imported as an explicit override. */
  over_cap?: boolean;
  /** Dates in this row that were at capacity. */
  over_cap_dates?: string[];
  /** For each over-cap date: resulting count vs the area cap (for reporting). */
  over_cap_counts?: { date: string; count: number; cap: number; area: string }[];
  /** Marks the row as written by a privileged bulk import (bypasses request-time caps). */
  import_source?: string;
};

/**
 * Normalise a badge from either the sheet or the directory:
 * strings, numeric Excel cells, spaces/dashes and leading zeros all collapse to the same key.
 */
export function normalizeBadge(v: unknown): string {
  if (v == null) return "";
  const digits = String(v).trim().replace(/\D/g, "");
  const stripped = digits.replace(/^0+/, "");
  return stripped;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && bStart <= aEnd;
}

function mapStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "Approved";
  if (s.startsWith("rej") || s.startsWith("den")) return "Rejected";
  if (s.startsWith("pen") || s.startsWith("wait")) return "Pending";
  return "Approved";
}

export type ExistingLeave = {
  id: string; staff_id: string | null; staff_email: string;
  start_date: string; end_date: string; status: string;
  area?: string | null;
};

/** Walk an inclusive ISO date range using calendar arithmetic only — no timezone conversion. */
function eachISO(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  let [y, m, d] = [sy, sm, sd];
  const iso = () => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let guard = 0;
  while (iso() <= end && guard++ < 1000) {
    out.push(iso());
    d++;
    if (d > new Date(y, m, 0).getDate()) { d = 1; m++; }
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Badge-driven vacation import planning, shared by every area.
 * Name and area always come from the staff directory; the file's name/area are never trusted.
 */
export function planVacationImport(input: {
  rows: Record<string, unknown>[];
  area: string;
  /** Skip rows whose directory area differs from `area`. */
  allAreas?: boolean;
  staff: DirectoryStaffLite[];
  existing: ExistingLeave[];
  /** Max staff off per day, keyed by area. Areas without an entry are unlimited. */
  capByArea?: Record<string, number>;
  /** Whether Pending rows count toward the cap (system rule). */
  countsPending?: boolean;
  /** Import rows that exceed the cap as explicit overrides instead of skipping them. */
  overrideCap?: boolean;
  /**
   * Privileged Excel import by an admin/supervisor: caps, day locks and deadlines are
   * request-time rules only and must never block an import. Rows over the cap are still
   * imported, tagged `over_cap` and reported.
   */
  bypassCaps?: boolean;
}): ImportItem<VacationImportPayload>[] {
  const { rows, area, allAreas = false, staff, existing, capByArea = {}, countsPending = true, overrideCap = false, bypassCaps = false } = input;
  const allowOverCap = overrideCap || bypassCaps;
  const byBadge = new Map<string, DirectoryStaffLite>();
  for (const s of staff) {
    const key = normalizeBadge(s.badge_id);
    if (key) byBadge.set(key, s);
  }

  const planned: { staffId: string; start: string; end: string }[] = [];

  // Day usage per area from what is already booked, so the preview sees the same
  // numbers the calendar and the database trigger use.
  const usage = new Map<string, number>();
  const usedKey = (a: string, iso: string) => `${a}\u0000${iso}`;
  for (const r of existing) {
    if (r.status === "Rejected") continue;
    if (!countsPending && r.status !== "Approved") continue;
    const a = r.area ?? area;
    for (const iso of eachISO(r.start_date, r.end_date)) {
      usage.set(usedKey(a, iso), (usage.get(usedKey(a, iso)) ?? 0) + 1);
    }
  }

  // Deterministic results: evaluate rows in start-date order so cap slots are
  // handed out earliest-first regardless of the file's row order.
  const ordered = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const sa = toISODateValue(field(a.row, "Vacation Start", "Start", "Start Date", "From")) ?? "9999-12-31";
      const sb = toISODateValue(field(b.row, "Vacation Start", "Start", "Start Date", "From")) ?? "9999-12-31";
      return sa === sb ? a.i - b.i : sa < sb ? -1 : 1;
    });

  return ordered.map(({ row, i }) => {
    const rawBadge = field(row, "Badge", "Badge No", "Badge Number", "BadgeID", "Employee ID", "Emp ID", "ID");
    const badge = normalizeBadge(rawBadge);
    const fileName = field(row, "Staff Name", "Full Name", "Name");
    const start = toISODateValue(field(row, "Vacation Start", "Start", "Start Date", "From"));
    const end = toISODateValue(field(row, "Vacation End", "End", "End Date", "To"));
    const status = mapStatus(field(row, "Status"));
    const id = `v${i}`;
    const range = `${start ?? "?"} → ${end ?? "?"}`;
    const base = { id, badge: rawBadge.trim() || "—", label: fileName || `Row ${i + 2}`, change: range };
    const skip = (reason: string): ImportItem<VacationImportPayload> =>
      ({ ...base, status: "skip", reason });

    if (!badge) return skip("Missing badge");
    const member = byBadge.get(badge);
    if (!member) return skip(`Badge ${rawBadge.trim()} not found in staff directory`);

    const label = member.name;
    const memberArea = member.area ?? UNASSIGNED_AREA;
    if (!allAreas && (member.area ?? "").toLowerCase() !== area.toLowerCase()) {
      return { ...base, label, area: memberArea, status: "skip", reason: `Different area (${memberArea})` };
    }
    if (!start || !end) return { ...base, label, area: memberArea, status: "skip", reason: "Invalid dates" };
    if (end < start) return { ...base, label, area: memberArea, status: "skip", reason: "End before start" };

    const warnings: string[] = [];
    if (fileName && fileName.trim().toLowerCase() !== member.name.trim().toLowerCase()) {
      warnings.push(`File says "${fileName.trim()}", directory says "${member.name}"`);
    }

    const mine = existing.filter(
      (r) => (r.staff_id ? r.staff_id === member.id : r.staff_email.toLowerCase() === member.email.toLowerCase()),
    );
    const exact = mine.find((r) => r.start_date === start && r.end_date === end);
    const overlapping = mine.filter((r) => r !== exact && overlaps(start, end, r.start_date, r.end_date));
    if (overlapping.length > 0) {
      warnings.push(`Overlaps existing leave ${overlapping[0].start_date} → ${overlapping[0].end_date}`);
    }
    if (planned.some((p) => p.staffId === member.id && p.start === start && p.end === end)) {
      return { ...base, label, area: memberArea, status: "skip", reason: "Duplicate row in file" };
    }

    const rowArea = member.area ?? UNASSIGNED_AREA;
    const cap = capByArea[rowArea];
    const days = eachISO(start, end);
    const countsTowardCap = countsPending || status === "Approved";
    let blocked: string[] = [];
    if (typeof cap === "number" && cap > 0 && !exact) {
      blocked = days.filter((iso) => (usage.get(usedKey(rowArea, iso)) ?? 0) >= cap);
    }
    if (blocked.length > 0 && !allowOverCap) {
      return {
        ...base, label, area: memberArea, status: "skip",
        reason: `Exceeds ${rowArea} cap on ${blocked.join(", ")}`,
      };
    }

    planned.push({ staffId: member.id, start, end });
    if (countsTowardCap && !exact) {
      for (const iso of days) usage.set(usedKey(rowArea, iso), (usage.get(usedKey(rowArea, iso)) ?? 0) + 1);
    }
    const overCapCounts = blocked.map((iso) => ({
      date: iso, area: rowArea, cap: cap as number,
      count: usage.get(usedKey(rowArea, iso)) ?? cap as number,
    }));
    if (blocked.length > 0) {
      warnings.push(`Over cap on ${blocked.join(", ")} — imported as override`);
    }

    const payload: VacationImportPayload = {
      badge, staff_id: member.id, staff_email: member.email, staff_name: member.name,
      area: member.area ?? UNASSIGNED_AREA, start_date: start, end_date: end, status,
      ...(bypassCaps ? { import_source: "excel_import" } : {}),
      ...(blocked.length > 0 ? { over_cap: true, over_cap_dates: blocked, over_cap_counts: overCapCounts } : {}),
      ...(exact ? { existing_id: exact.id } : {}),
    };

    if (exact && exact.status === status) {
      return { ...base, label, area: memberArea, status: "skip", reason: "No change (already imported)" };
    }
    return {
      ...base, label, area: memberArea,
      status: exact ? "update" : "add",
      ...(warnings.length ? { warning: warnings.join(" · ") } : {}),
      payload,
    };
  });
}

export type VacationCommitResult = {
  written: number;
  attempted: number;
  confirmed: number;
  errors: { badge: string; name: string; range: string; message: string }[];
};

/**
 * Write planned vacation rows in small batches. A failing batch is retried row by row so one
 * bad row never aborts the import; every failure is reported with its badge and Postgres message.
 */
export async function commitVacationImport(
  items: ImportItem<VacationImportPayload>[],
  opts: { approverEmail: string; setProgress?: (t: string | null) => void; overrideReason?: string },
): Promise<VacationCommitResult> {
  const rows = items.map((i) => i.payload!).filter(Boolean);
  const errors: VacationCommitResult["errors"] = [];
  let written = 0;
  const writtenIds: string[] = [];

  // The batch runs server-side so RLS read-back visibility can never be mistaken for a
  // failed write, and each row reports its real Postgres error instead of a generic message.
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    opts.setProgress?.(`Writing ${Math.min(i + chunk.length, rows.length)} / ${rows.length} rows…`);
    const payload = chunk.map((p) => ({
      // `area` is intentionally NOT sent: the database derives it from the staff directory.
      badge: p.badge,
      staff_id: p.staff_id,
      staff_email: p.staff_email.toLowerCase(),
      staff_name: p.staff_name,
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
      existing_id: p.existing_id ?? null,
      over_cap: !!p.over_cap,
    }));
    const { data, error } = await supabase.rpc("import_vacations_batch", {
      _rows: payload,
      _approver: opts.approverEmail,
      _override_reason: opts.overrideReason?.trim() || "Excel import",
    });
    if (error) {
      // Whole batch rejected (e.g. permission): report it against every row in the batch.
      for (const p of chunk) {
        errors.push({
          badge: p.badge, name: p.staff_name,
          range: `${p.start_date} → ${p.end_date}`,
          message: `${error.message}${error.hint ? ` (${error.hint})` : ""}`,
        });
      }
      continue;
    }
    const result = data as {
      written: number; updated: number; attempted: number;
      rows: { badge: string; name: string; range: string; status: string; id?: string; error?: string }[];
    };
    for (const r of result?.rows ?? []) {
      if (r.status === "failed") {
        errors.push({ badge: r.badge, name: r.name, range: r.range, message: r.error ?? "Unknown error" });
      } else {
        written += 1;
        if (r.id) writtenIds.push(r.id);
      }
    }
  }

  // Re-query so the reported number is what is actually committed, not what we asked for.
  let confirmed = 0;
  for (let i = 0; i < writtenIds.length; i += 200) {
    const { count } = await supabase.from("leave_requests")
      .select("id", { count: "exact", head: true })
      .in("id", writtenIds.slice(i, i + 200));
    confirmed += count ?? 0;
  }
  opts.setProgress?.(null);
  return { written, attempted: rows.length, confirmed, errors };
}
