-- ═══════════════════════════════════════════════════════════
-- InstaPort TMS — Supabase Schema (Multi-Tenant Edition)
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- ═══════════════════════════════════════════════════════════

-- ── TENANTS ─────────────────────────────────────────────────
-- Each row = one company / workspace
CREATE TABLE IF NOT EXISTS public.tenants (
  id            TEXT PRIMARY KEY,          -- short code: 'acme', 'instaport'
  name          TEXT NOT NULL,             -- display name: "Acme Logistics Ltd."
  logo_url      TEXT DEFAULT '',
  plan          TEXT DEFAULT 'starter',    -- starter | pro | enterprise
  active        BOOLEAN DEFAULT TRUE,
  admin_email   TEXT DEFAULT '',
  max_users     INTEGER DEFAULT 20,
  max_trucks    INTEGER DEFAULT 50,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── TRIPS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trips (
  id            TEXT NOT NULL,
  tenant_id     TEXT NOT NULL DEFAULT 'instaport',
  customer      TEXT,
  type          TEXT,
  dir           TEXT,
  condition     TEXT,
  origin        TEXT,          -- JS: trip.from  ("from" is reserved)
  dests         TEXT,
  dests_arr     JSONB DEFAULT '[]',
  km            NUMERIC,
  cost          NUMERIC,
  co2           NUMERIC,
  cost_breakdown JSONB,
  truck         TEXT,
  driver        TEXT,
  driver_note   TEXT DEFAULT '',
  actual_km     NUMERIC,
  status        TEXT,
  checklist     JSONB DEFAULT '[]',
  quality_pin   BOOLEAN DEFAULT FALSE,
  ai_report     JSONB,
  attachments   JSONB DEFAULT '[]',
  timeline      JSONB DEFAULT '[]',  -- JS: trip.tl
  ts            TEXT,
  created_by    TEXT,
  price_plan    TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS trips_tenant_idx     ON public.trips(tenant_id);
CREATE INDEX IF NOT EXISTS trips_status_idx     ON public.trips(status);
CREATE INDEX IF NOT EXISTS trips_customer_idx   ON public.trips(customer);
CREATE INDEX IF NOT EXISTS trips_created_at_idx ON public.trips(created_at DESC);

-- ── TRUCKS ──────────────────────────────────────────────────
-- Composite PK: same plate can exist in different tenants
CREATE TABLE IF NOT EXISTS public.trucks (
  plate         TEXT NOT NULL,
  tenant_id     TEXT NOT NULL DEFAULT 'instaport',
  type          TEXT,
  mfr           TEXT,
  cooling       TEXT,
  status        TEXT    DEFAULT 'Released',
  valid         BOOLEAN DEFAULT TRUE,
  remark        TEXT    DEFAULT '',
  cal_expiry    DATE,
  flagged       BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (plate, tenant_id)
);

CREATE INDEX IF NOT EXISTS trucks_tenant_idx ON public.trucks(tenant_id);

-- ── MAINTENANCE TICKETS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.maintenance (
  id            TEXT NOT NULL,
  tenant_id     TEXT NOT NULL DEFAULT 'instaport',
  truck         TEXT,
  description   TEXT,           -- JS: ticket.desc  ("desc" is reserved)
  parts         JSONB DEFAULT '[]',
  status        TEXT DEFAULT 'open',
  ts            TEXT,
  attachments   JSONB DEFAULT '[]',
  auto          BOOLEAN DEFAULT FALSE,
  trip_id       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS maintenance_tenant_idx  ON public.maintenance(tenant_id);
CREATE INDEX IF NOT EXISTS maintenance_truck_idx   ON public.maintenance(truck);
CREATE INDEX IF NOT EXISTS maintenance_status_idx  ON public.maintenance(status);

-- ── SPARE PARTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.spare_parts (
  id            TEXT NOT NULL,
  tenant_id     TEXT NOT NULL DEFAULT 'instaport',
  name          TEXT,
  sku           TEXT,
  qty           INTEGER DEFAULT 0,
  min_qty       INTEGER DEFAULT 0,   -- JS: part.minQty
  unit          TEXT,
  cost          NUMERIC,
  supplier      TEXT,
  category      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS spare_parts_tenant_idx ON public.spare_parts(tenant_id);

-- ── USERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id            TEXT NOT NULL,
  tenant_id     TEXT NOT NULL DEFAULT 'instaport',
  pin           TEXT,           -- keep hashed in production
  name          TEXT,
  role          TEXT,
  email         TEXT,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS users_tenant_idx ON public.users(tenant_id);

-- ── PRICE LISTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.price_lists (
  id            TEXT NOT NULL,
  tenant_id     TEXT NOT NULL DEFAULT 'instaport',
  customer      TEXT,
  name          TEXT,
  config        JSONB,          -- stores all pricing criteria fields
  active        BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS price_lists_tenant_idx   ON public.price_lists(tenant_id);
CREATE INDEX IF NOT EXISTS price_lists_customer_idx ON public.price_lists(customer);

-- ── AUDIT LOG ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'instaport',
  ts            TEXT,
  username      TEXT,           -- JS: entry.user  ("user" is reserved)
  role          TEXT,
  action        TEXT,
  detail        TEXT,
  trip_id       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_tenant_idx    ON public.audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx    ON public.audit_log(action);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log(created_at DESC);

-- ── CUSTOMERS ───────────────────────────────────────────────
-- Composite PK: same customer name can exist across tenants
CREATE TABLE IF NOT EXISTS public.customers (
  name               TEXT NOT NULL,
  tenant_id          TEXT NOT NULL DEFAULT 'instaport',
  base_rate          NUMERIC,
  min_charge         NUMERIC,
  wt_factor          NUMERIC,
  truck_mult         JSONB,         -- { Jumbo, Dababa, Trailer, "Truck Head" }
  fuel_adj           NUMERIC DEFAULT 1.0,
  refrig_surcharge   NUMERIC DEFAULT 15,
  frozen_extra       NUMERIC DEFAULT 8,
  emergency_surcharge NUMERIC DEFAULT 25,
  waiting_rate       NUMERIC DEFAULT 120,
  stop_fee           NUMERIC DEFAULT 60,
  seasonal           NUMERIC DEFAULT 0,
  discount_pct       NUMERIC DEFAULT 0,
  bonus              NUMERIC DEFAULT 0,
  sla_min            INTEGER DEFAULT 2,
  sla_max            INTEGER DEFAULT 8,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (name, tenant_id)
);

CREATE INDEX IF NOT EXISTS customers_tenant_idx ON public.customers(tenant_id);

-- ═══════════════════════════════════════════════════════════
-- Seed the default "instaport" demo tenant
-- Run this block once to create the demo workspace
-- ═══════════════════════════════════════════════════════════
INSERT INTO public.tenants (id, name, plan, active, admin_email)
VALUES ('instaport', 'InstaPort Logistics', 'enterprise', true, 'admin@instaport.com')
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- Row Level Security (enable after schema is ready)
-- All policies enforce tenant_id isolation
-- ═══════════════════════════════════════════════════════════
-- Step 1 — Enable RLS on every table:
-- ALTER TABLE public.tenants      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.trips        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.trucks       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.maintenance  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.spare_parts  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.price_lists  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.audit_log    ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.customers    ENABLE ROW LEVEL SECURITY;

-- Step 2 — Allow anon key full access (current app uses app-level tenant filtering):
-- CREATE POLICY "anon_all_trips"       ON public.trips        FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "anon_all_trucks"      ON public.trucks       FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "anon_all_maint"       ON public.maintenance  FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "anon_all_parts"       ON public.spare_parts  FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "anon_all_users"       ON public.users        FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "anon_all_price"       ON public.price_lists  FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "anon_all_audit"       ON public.audit_log    FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "anon_all_customers"   ON public.customers    FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "anon_all_tenants"     ON public.tenants      FOR ALL USING (true) WITH CHECK (true);

-- Step 3 — Future upgrade: server-side RLS using JWT claims (requires Supabase Auth):
-- CREATE POLICY "tenant_isolation_trips" ON public.trips
--   FOR ALL USING (tenant_id = current_setting('request.jwt.claims', true)::json->>'tenant_id');
