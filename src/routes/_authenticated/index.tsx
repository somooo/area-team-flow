import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { canServer } from "@/lib/capabilities";

export const Route = createFileRoute("/_authenticated/")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    const email = u.user?.email;
    if (!email) throw redirect({ to: "/auth" });
    // Landing page follows capabilities, not job titles.
    if (await canServer("schedule.view")) throw redirect({ to: "/dashboard" });
    throw redirect({ to: "/dashboard" });
  },
});