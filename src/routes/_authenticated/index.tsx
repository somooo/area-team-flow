import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    const email = u.user?.email;
    if (!email) throw redirect({ to: "/auth" });
    const { data: staff } = await supabase
      .from("staff").select("role").ilike("email", email).maybeSingle();
    if (staff?.role === "admin") throw redirect({ to: "/reports" });
    if (staff?.role === "supervisor") throw redirect({ to: "/supervisor" });
    throw redirect({ to: "/dashboard" });
  },
});