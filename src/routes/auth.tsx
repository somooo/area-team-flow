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
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-lg border-steel-200">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-fit rounded-xl bg-ink px-6 py-5">
            <KadirLogo size="lg" className="[&_*]:text-bone" />
          </div>
          <CardTitle className="font-display text-2xl uppercase tracking-[0.12em]">Sign in</CardTitle>
          <CardDescription>Hospital staff operations — sign in with your Google account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={signIn}>Continue with Google</Button>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <p className="text-xs text-muted-foreground text-center">
            Access is granted to hospital staff on the roster only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}