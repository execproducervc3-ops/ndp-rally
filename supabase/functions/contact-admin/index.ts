// "Contact admin" from Event Pal: the promoter (owner PIN) or an operator/assistant (their own PIN)
// sends a message or voice note to the administrator. Checks the PIN exactly as the control function
// does, then passes it to AVA (askvincy.com/api/contact-admin) with the shared MONITOR_KEY.
// AVA delivers it on Telegram and rate-limits it. One-way: the admin calls or messages them back.
//
// Secrets: CONTROL_PIN (already set), MONITOR_KEY (same value as AVA's), EVENT_NAME (optional label).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pin", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const enc = new TextEncoder();
async function sha(salt: string, pin: string) {
  const b = await crypto.subtle.digest("SHA-256", enc.encode(salt + ":" + pin));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// who is sending: the promoter (CONTROL_PIN) or a team member with their own PIN
async function contactIdentity(req: Request): Promise<{ name: string; role: string } | null> {
  const owner = Deno.env.get("CONTROL_PIN") || "";
  const got = (req.headers.get("x-pin") || "").trim();
  if (!got || got.length > 64) return null;
  if (owner && same(owner, got)) return { name: "Promoter", role: "Promoter" };
  const { data } = await sb.from("operators").select("name,role,salt,pin_hash");
  for (const o of data || []) {
    if (same(await sha(o.salt, got), o.pin_hash)) return { name: o.name, role: o.role === "operator" ? "Operator" : "Photo assistant" };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, error: "POST only" }, 405);
  const key = Deno.env.get("MONITOR_KEY") || "";
  if (key.length < 16) return reply({ ok: false, error: "Contact admin isn't set up yet." }, 503);
  const who = await contactIdentity(req);
  if (!who) { await new Promise((r) => setTimeout(r, 600)); return reply({ ok: false, error: "Sign in again, then try." }, 401); }
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply({ ok: false, error: "Bad request." }, 400); }
  const voice = b.voice as { b64?: string; mime?: string; seconds?: number } | null;
  if (voice?.b64 && voice.b64.length > 2_000_000) return reply({ ok: false, error: "That voice note is too long. Keep it under a minute." }, 413);
  const r = await fetch("https://askvincy.com/api/contact-admin", {
    method: "POST", headers: { "Content-Type": "application/json", "x-monitor-key": key },
    body: JSON.stringify({ app: "Event Pal", from: { name: who.name, role: who.role, business: Deno.env.get("EVENT_NAME") || "Event Pal event" },
      screen: String(b.screen || "").slice(0, 40), text: String(b.text || "").slice(0, 1000), voice: voice?.b64 ? voice : null }),
    signal: AbortSignal.timeout(25000),
  }).catch(() => null);
  if (!r) return reply({ ok: false, error: "Couldn't reach the admin's line. Try again, or call." }, 502);
  const j = await r.json().catch(() => ({}));
  return reply(r.ok ? { ok: true } : { ok: false, error: (j as { error?: string }).error || "It didn't go through." }, r.ok ? 200 : r.status);
});
