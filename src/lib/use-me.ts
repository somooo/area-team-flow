import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Me = {
  authEmail: string;
  staff: {
    id: string;
    name: string;
    email: string;
    role: "staff" | "supervisor" | "admin";
    area: string | null;
    department: string | null;
    supervisor_email: string | null;
    delegated_to_email: string | null;
    delegation_active: boolean;
  } | null;
};

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const email = u.user?.email ?? "";
    if (!email) {
      setMe(null);
      setLoading(false);
      return;
    }
    const { data: staff } = await supabase
      .from("staff")
      .select("*")
      .ilike("email", email)
      .maybeSingle();
    setMe({ authEmail: email, staff: staff as Me["staff"] });
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  return { me, loading, reload: load };
}