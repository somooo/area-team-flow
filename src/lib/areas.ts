import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isProtectedTest } from "@/lib/staff-import";

/**
 * Areas are NOT hardcoded: the Staff Directory is the single source of truth.
 * Every dropdown (calendar, filters, import, reports) is populated from the
 * distinct area values found on staff records.
 */
export const SUPERVISORS_TEAM = "Supervisors";
/** Bucket for vacations whose staff is missing, inactive or has no area. */
export const UNASSIGNED_AREA = "Unassigned";

function isActive(status: string | null | undefined) {
  return (status ?? "Active").toLowerCase() === "active";
}

/** Distinct, sorted area values currently used by active staff in the directory. */
export async function fetchDirectoryAreas(): Promise<string[]> {
  const { data } = await supabase.from("staff").select("area,status,name,first_name");
  const set = new Set<string>();
  for (const s of (data ?? []) as { area: string | null; status: string | null; name?: string | null; first_name?: string | null }[]) {
    if (isProtectedTest(s)) continue;
    const a = (s.area ?? "").trim();
    if (!a || a === SUPERVISORS_TEAM || a === UNASSIGNED_AREA) continue;
    if (isActive(s.status)) set.add(a);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Live directory areas. Refetches on mount so directory edits show up immediately. */
export function useDirectoryAreas() {
  const [areas, setAreas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const list = await fetchDirectoryAreas();
    setAreas(list);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { areas, loading, refresh };
}
