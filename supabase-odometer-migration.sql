-- ═══════════════════════════════════════════════════════════
-- InstaPort TMS — Truck Odometer & Maintenance KM Migration
-- Run once in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- Add odometer tracking columns to trucks table
ALTER TABLE public.trucks ADD COLUMN IF NOT EXISTS odometer_km     NUMERIC DEFAULT 0;
ALTER TABLE public.trucks ADD COLUMN IF NOT EXISTS last_maint_km   NUMERIC DEFAULT 0;
ALTER TABLE public.trucks ADD COLUMN IF NOT EXISTS maint_interval_km NUMERIC DEFAULT 10000;

-- Add lat/lng columns so we can store geocoded origin/destination in trips
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS origin_lat  NUMERIC;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS origin_lng  NUMERIC;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS dest_lat    NUMERIC;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS dest_lng    NUMERIC;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS route_coords JSONB DEFAULT '[]';

-- Seed realistic starting odometers for instaport demo trucks
-- (these are example values — adjust as needed)
UPDATE public.trucks SET odometer_km = 42500, last_maint_km = 38000, maint_interval_km = 10000 WHERE plate = '4789 أ ج ي' AND tenant_id = 'instaport';
UPDATE public.trucks SET odometer_km = 38700, last_maint_km = 35000, maint_interval_km = 10000 WHERE plate = '4793 أ ج ي' AND tenant_id = 'instaport';
UPDATE public.trucks SET odometer_km = 71200, last_maint_km = 61000, maint_interval_km = 10000 WHERE plate = '834 ن ي م'  AND tenant_id = 'instaport';
UPDATE public.trucks SET odometer_km = 55400, last_maint_km = 50000, maint_interval_km = 10000 WHERE plate = 'ا س ف 367' AND tenant_id = 'instaport';
UPDATE public.trucks SET odometer_km = 28900, last_maint_km = 28000, maint_interval_km = 10000 WHERE plate = 'أ ج ي 5429' AND tenant_id = 'instaport';

-- ── Done ─────────────────────────────────────────────────
-- Trucks now track: odometer_km (total), last_maint_km (km at last service),
-- maint_interval_km (default 10,000 km between services)
-- Alert fires when: odometer_km - last_maint_km >= maint_interval_km
