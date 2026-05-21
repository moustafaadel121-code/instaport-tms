-- ═══════════════════════════════════════════════════════════
-- InstaPort TMS — Multi-Tenant Migration
-- Run this in Supabase SQL Editor to add tenant support
-- Safe to run multiple times (uses IF NOT EXISTS / DO NOTHING)
-- ═══════════════════════════════════════════════════════════

-- ── 1. Create TENANTS table (new) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  logo_url      TEXT DEFAULT '',
  plan          TEXT DEFAULT 'starter',
  active        BOOLEAN DEFAULT TRUE,
  admin_email   TEXT DEFAULT '',
  max_users     INTEGER DEFAULT 20,
  max_trucks    INTEGER DEFAULT 50,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Add tenant_id to existing tables ─────────────────────
ALTER TABLE public.trips       ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'instaport';
ALTER TABLE public.trucks      ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'instaport';
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'instaport';
ALTER TABLE public.spare_parts ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'instaport';
ALTER TABLE public.users       ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'instaport';
ALTER TABLE public.price_lists ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'instaport';
ALTER TABLE public.audit_log   ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'instaport';
ALTER TABLE public.customers   ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'instaport';

-- ── 3. Add indexes for fast tenant filtering ─────────────────
CREATE INDEX IF NOT EXISTS trips_tenant_idx       ON public.trips(tenant_id);
CREATE INDEX IF NOT EXISTS trucks_tenant_idx      ON public.trucks(tenant_id);
CREATE INDEX IF NOT EXISTS maintenance_tenant_idx ON public.maintenance(tenant_id);
CREATE INDEX IF NOT EXISTS spare_parts_tenant_idx ON public.spare_parts(tenant_id);
CREATE INDEX IF NOT EXISTS users_tenant_idx       ON public.users(tenant_id);
CREATE INDEX IF NOT EXISTS price_lists_tenant_idx ON public.price_lists(tenant_id);
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx   ON public.audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS customers_tenant_idx   ON public.customers(tenant_id);

-- ── 4. Seed the default InstaPort tenant ────────────────────
INSERT INTO public.tenants (id, name, plan, active, admin_email)
VALUES ('instaport', 'InstaPort Logistics', 'enterprise', true, 'admin@instaport.com')
ON CONFLICT (id) DO NOTHING;

-- ── 5. Tag all existing data as belonging to 'instaport' ─────
-- (already done by DEFAULT 'instaport' above, but this covers any NULLs)
UPDATE public.trips       SET tenant_id = 'instaport' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE public.trucks      SET tenant_id = 'instaport' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE public.maintenance SET tenant_id = 'instaport' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE public.spare_parts SET tenant_id = 'instaport' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE public.users       SET tenant_id = 'instaport' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE public.price_lists SET tenant_id = 'instaport' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE public.audit_log   SET tenant_id = 'instaport' WHERE tenant_id IS NULL OR tenant_id = '';
UPDATE public.customers   SET tenant_id = 'instaport' WHERE tenant_id IS NULL OR tenant_id = '';

-- ── Done ────────────────────────────────────────────────────
-- All existing data is now tagged as 'instaport'
-- New organizations registered via the app will get their own tenant_id
