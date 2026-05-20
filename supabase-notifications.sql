-- InstaPort TMS — Notification Log Table
-- Run in Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS public.notification_log (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'instaport',
  alert_type    TEXT NOT NULL,   -- 'maintenance_due' | 'calibration' | 'license'
  recipients    JSONB,           -- array of email addresses
  subject       TEXT,
  sent_count    INTEGER DEFAULT 0,
  failed_count  INTEGER DEFAULT 0,
  results       JSONB,
  sent_at       TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: only the tenant's users can read their own logs
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read own logs"
  ON public.notification_log FOR SELECT
  USING (tenant_id = 'instaport');

CREATE POLICY "Service role full access"
  ON public.notification_log FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_notif_log_tenant ON public.notification_log(tenant_id, sent_at DESC);
