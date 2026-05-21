-- ═══════════════════════════════════════════════════════════
-- InstaPort TMS — RLS Policies (allow anon key full access)
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- Allow anon key to read/write all tables
-- (tenant isolation is enforced in the app code via tenant_id filtering)

CREATE POLICY "anon_all" ON public.tenants      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.trips        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.trucks       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.maintenance  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.spare_parts  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.users        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.price_lists  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.audit_log    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.customers    FOR ALL USING (true) WITH CHECK (true);
