// InstaPort TMS — send-alert Edge Function
// Sends email alerts via Resend + logs to notification_log table
// Deploy: npx supabase functions deploy send-alert --project-ref qugypjbwkhqkvmrntfus
// Secrets: npx supabase secrets set RESEND_API_KEY=re_xxxx --project-ref qugypjbwkhqkvmrntfus

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const {
      to_emails = [],
      subject = "",
      body_html = "",
      body_text = "",
      alert_type = "general",
      tenant_id = "instaport",
    } = await req.json();

    const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
    const FROM = Deno.env.get("FROM_EMAIL") ?? "InstaPort TMS <onboarding@resend.dev>";

    if (!RESEND_KEY) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY secret not set. See setup instructions." }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const results: { email: string; ok: boolean; id?: string; error?: string }[] = [];

    // Send one email per recipient via Resend
    for (const email of to_emails) {
      if (!email || !email.includes("@")) continue;
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM,
            to: [email],
            subject,
            html: body_html || `<pre style="font-family:sans-serif">${body_text}</pre>`,
            text: body_text,
          }),
        });
        const data = await res.json();
        results.push({ email, ok: res.ok, id: data.id, error: data.message });
      } catch (err) {
        results.push({ email, ok: false, error: String(err) });
      }
    }

    // Log to notification_log table
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase.from("notification_log").insert({
        tenant_id,
        alert_type,
        recipients: to_emails,
        subject,
        sent_count: results.filter((r) => r.ok).length,
        failed_count: results.filter((r) => !r.ok).length,
        results,
        sent_at: new Date().toISOString(),
      });
    } catch (_) { /* logging failure is non-fatal */ }

    const sent = results.filter((r) => r.ok).length;
    return new Response(
      JSON.stringify({ success: true, sent, failed: results.length - sent, results }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
