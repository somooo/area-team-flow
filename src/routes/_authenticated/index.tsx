import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user?.email) throw redirect({ to: "/auth" });
    // Everyone lands on the schedule; per-page access is decided by capabilities.
    throw redirect({ to: "/dashboard" });
  },
});