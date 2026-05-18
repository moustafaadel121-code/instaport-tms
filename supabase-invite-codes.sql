-- ═══════════════════════════════════════════════════════════
-- InstaPort TMS — Invite Codes Table
-- Run once in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.invite_codes (
  id          TEXT PRIMARY KEY,        -- the code itself e.g. INST-2026-XK9
  label       TEXT DEFAULT '',         -- client name / note
  active      BOOLEAN DEFAULT TRUE,    -- false = disabled
  used_by     TEXT DEFAULT '',         -- org code that used it
  used_at     TIMESTAMPTZ,             -- when it was used
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the 5 existing codes
INSERT INTO public.invite_codes (id, label, active) VALUES
('INST-2026-XK9', 'Client 1', true),
('INST-2026-QM7', 'Client 2', true),
('INST-2026-BR4', 'Client 3', true),
('INST-2026-ZT1', 'Client 4', true),
('INST-2026-NW5', 'Client 5', true)
ON CONFLICT (id) DO NOTHING;
