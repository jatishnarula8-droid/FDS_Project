// Supabase Edge Function: POST /functions/v1/ingest-punches
// Receives batches of punches from the mess "device bridge", validates them, and calls the SQL function
// ingest_punch() for each one. All business rules live in SQL; this function is a thin, authenticated door.
//
// Deploy with --no-verify-jwt (see config.toml): devices/bridge authenticate with the x-device-secret header.
// Biometric templates are never accepted: only device serial, numeric device user id, and punch time.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const MAX_BATCH = 500;

const PunchSchema = z.object({
  device_serial: z.string().min(1).max(100),
  device_user_id: z.string().min(1).max(50),
  punched_at: z.string().datetime({ offset: true }), // ISO 8601 with offset or Z
  verify_mode: z.number().int().min(0).max(255).nullish(),
  raw: z.record(z.unknown()).optional(),
});
const BodySchema = z.object({
  punches: z.array(PunchSchema).max(MAX_BATCH).default([]),
  // serials of machines the bridge could reach during its last poll (drives online/offline on the Devices page)
  heartbeats: z.array(z.string().min(1).max(100)).max(50).optional(),
}).refine((b) => b.punches.length > 0 || (b.heartbeats?.length ?? 0) > 0, { message: "Send punches and/or heartbeats" });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Constant-time string comparison so the secret can't be guessed via timing. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("DEVICE_INGEST_SECRET");
  if (!expected || expected.startsWith("YOUR_")) return json({ error: "server_not_configured" }, 500);
  const provided = req.headers.get("x-device-secret") ?? "";
  if (!safeEqual(provided, expected)) return json({ error: "unauthorized" }, 401);

  let payload: unknown;
  try { payload = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) return json({ error: "invalid_payload", issues: parsed.error.issues }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // server-side only; never sent to a browser
    { auth: { persistSession: false } },
  );

  const receivedAt = new Date().toISOString(); // server clock; device clocks are not trusted
  for (const serial of parsed.data.heartbeats ?? []) {
    await supabase.rpc("device_heartbeat", { p_serial: serial, p_at: receivedAt });
  }
  const results = [];
  for (const [index, p] of parsed.data.punches.entries()) {
    const { data, error } = await supabase.rpc("ingest_punch", {
      p_device_serial: p.device_serial,
      p_device_user_id: p.device_user_id,
      p_punched_at: p.punched_at,
      p_verify_mode: p.verify_mode ?? null,
      p_raw: p.raw ?? {},
      p_received_at: receivedAt,
    });
    results.push({
      index,
      device_serial: p.device_serial,
      device_user_id: p.device_user_id,
      punched_at: p.punched_at,
      ...(error ? { status: "error", error: error.message } : data),
    });
  }

  // 200 even if individual punches errored: per-punch status tells the bridge what to retry.
  return json({ results });
});
