import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KadirLogo } from "@/components/KadirLogo";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [{ title: "Sign in — KADIR Staff Management" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const signIn = async () => {
    setError(null);
    const res = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (res.error) setError(res.error.message ?? "Sign-in failed");
    if (!res.error && !res.redirected) navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen bg-bone flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-2xl border-0 bg-ink text-bone overflow-hidden">
        <div className="bg-gradient-to-br from-ink to-steel-900 p-10 text-center">
          <div className="mx-auto mb-6 inline-flex items-center justify-center rounded-2xl bg-bone/10 p-5">
            <KadirLogo size="lg" showTagline={false} className="[&_*]:text-bone" />
          </div>
          <div className="font-display text-4xl font-semibold uppercase tracking-[0.22em] text-bone">
            KADIR
          </div>
          <div className="mt-2 text-sm font-medium uppercase tracking-[0.28em] text-copper">
            Staff Management
          </div>
        </div>
        <CardContent className="p-8 space-y-4 bg-ink">
          <Button
            className="w-full bg-bone text-ink hover:bg-bone/90 font-semibold uppercase tracking-wider"
            onClick={signIn}
          >
            Continue with Google
          </Button>
          {error && <p className="text-sm text-destructive-foreground text-center">{error}</p>}
          <p className="text-xs text-bone/60 text-center">
            Access is granted to hospital staff on the roster only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}