import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// PBKDF2 hashing helpers (workerd-safe via SubtleCrypto)
async function pbkdf2(password: string, saltB64: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function timingEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const setBadgePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { badgeId: string; password: string; email: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Authorization: caller must be admin OR setting their own badge/password
    const callerEmail = (context.claims?.email as string | undefined)?.toLowerCase() ?? "";
    const target = data.email.toLowerCase();
    let allowed = callerEmail === target;
    if (!allowed) {
      const { data: me } = await supabaseAdmin
        .from("staff").select("role").eq("email", callerEmail).maybeSingle();
      allowed = me?.role === "admin";
    }
    if (!allowed) throw new Error("Forbidden");
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const saltB64 = btoa(String.fromCharCode(...saltBytes));
    const hash = await pbkdf2(data.password, saltB64);
    const stored = `pbkdf2$100000$${saltB64}$${hash}`;
    const { data: staffRow, error } = await supabaseAdmin
      .from("staff")
      .update({ badge_id: data.badgeId })
      .ilike("email", data.email)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!staffRow?.id) throw new Error("Staff not found");
    const { error: secErr } = await supabaseAdmin
      .from("staff_secrets")
      .upsert({ staff_id: staffRow.id, password_hash: stored }, { onConflict: "staff_id" });
    if (secErr) throw new Error(secErr.message);
    return { ok: true as const };
  });

export const badgeSignIn = createServerFn({ method: "POST" })
  .inputValidator((d: { badgeId: string; password: string }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Throttle: 5 failed attempts / 15 min per badge_id
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("badge_signin_attempts")
      .select("succeeded, created_at")
      .eq("badge_id", data.badgeId)
      .gte("created_at", cutoff);
    const fails = (recent ?? []).filter(r => !r.succeeded).length;
    if (fails >= 5) return { ok: false as const, error: "Too many attempts. Try again later." };
    const record = async (succeeded: boolean) => {
      await supabaseAdmin.from("badge_signin_attempts").insert({ badge_id: data.badgeId, succeeded });
    };
    const { data: row } = await supabaseAdmin
      .from("staff")
      .select("id,email")
      .eq("badge_id", data.badgeId)
      .maybeSingle();
    const { data: secret } = row?.id
      ? await supabaseAdmin.from("staff_secrets").select("password_hash").eq("staff_id", row.id).maybeSingle()
      : { data: null as { password_hash: string | null } | null };
    if (!row || !row.email || !secret?.password_hash) { await record(false); return { ok: false as const, error: "Invalid badge or password" }; }
    const parts = secret.password_hash.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") { await record(false); return { ok: false as const, error: "Invalid credential format" }; }
    const computed = await pbkdf2(data.password, parts[2]);
    if (!timingEq(computed, parts[3])) { await record(false); return { ok: false as const, error: "Invalid badge or password" }; }
    // Issue a magic link so the browser establishes a real Supabase session
    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: row.email as string,
    });
    if (linkErr || !link?.properties?.action_link) { await record(false); return { ok: false as const, error: "Could not issue session link" }; }
    await record(true);
    return { ok: true as const, actionLink: link.properties.action_link };
  });