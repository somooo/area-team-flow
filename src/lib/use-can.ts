import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  type Capability,
  type CapabilityActor,
  activeCoverAssignments,
  can as resolveCan,
  loadActor,
} from "@/lib/capabilities";

/** Session cache: the capability set is loaded once, not per render. */
let cached: { email: string; actor: CapabilityActor } | null = null;

export function clearCapabilityCache() {
  cached = null;
}

export function useCapabilities() {
  const [actor, setActor] = useState<CapabilityActor>(cached?.actor ?? null);
  const [loading, setLoading] = useState(!cached);

  const load = useCallback(async (force = false) => {
    const { data: u } = await supabase.auth.getUser();
    const email = (u.user?.email ?? "").toLowerCase();
    if (!email) {
      cached = null;
      setActor(null);
      setLoading(false);
      return;
    }
    if (!force && cached?.email === email) {
      setActor(cached.actor);
      setLoading(false);
      return;
    }
    const { data: staff } = await supabase.from("staff").select("id").ilike("email", email).maybeSingle();
    const next = staff?.id ? await loadActor(staff.id as string) : null;
    cached = { email, actor: next };
    setActor(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const can = useCallback(
    (action: Capability, area?: string | null) => resolveCan(actor, action, area),
    [actor],
  );

  return { actor, can, loading, reload: () => load(true), covering: activeCoverAssignments(actor) };
}
