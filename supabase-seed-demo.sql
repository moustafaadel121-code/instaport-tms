-- ═══════════════════════════════════════════════════════════
-- InstaPort TMS — Demo Seed Data for "instaport" tenant
-- Run this in Supabase SQL Editor to get demo trips & data
-- ═══════════════════════════════════════════════════════════

-- ── Fix missing columns on trucks ───────────────────────────
ALTER TABLE public.trucks ADD COLUMN IF NOT EXISTS mfr        TEXT DEFAULT '';
ALTER TABLE public.trucks ADD COLUMN IF NOT EXISTS cooling    TEXT DEFAULT '';
ALTER TABLE public.trucks ADD COLUMN IF NOT EXISTS remark     TEXT DEFAULT '';
ALTER TABLE public.trucks ADD COLUMN IF NOT EXISTS flagged    BOOLEAN DEFAULT FALSE;
ALTER TABLE public.trucks ADD COLUMN IF NOT EXISTS cal_expiry DATE;
ALTER TABLE public.trucks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ── Fix missing columns on trips ────────────────────────────
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS type         TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS dir          TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS condition    TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS origin       TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS dests        TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS dests_arr    JSONB DEFAULT '[]';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS km           NUMERIC;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cost         NUMERIC;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS co2          NUMERIC;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cost_breakdown JSONB;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS truck        TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS driver       TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS driver_note  TEXT DEFAULT '';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS actual_km    NUMERIC;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS checklist    JSONB DEFAULT '[]';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS quality_pin  BOOLEAN DEFAULT FALSE;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS ai_report    JSONB;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS attachments  JSONB DEFAULT '[]';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS timeline     JSONB DEFAULT '[]';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS ts           TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS created_by   TEXT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS price_plan   TEXT DEFAULT '';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS notes        TEXT DEFAULT '';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ DEFAULT NOW();

-- ── Fix missing columns on maintenance ──────────────────────
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS parts       JSONB DEFAULT '[]';
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS auto        BOOLEAN DEFAULT FALSE;
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS trip_id     TEXT;
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

-- ── Fix missing columns on spare_parts ──────────────────────
ALTER TABLE public.spare_parts ADD COLUMN IF NOT EXISTS sku        TEXT;
ALTER TABLE public.spare_parts ADD COLUMN IF NOT EXISTS min_qty    INTEGER DEFAULT 0;
ALTER TABLE public.spare_parts ADD COLUMN IF NOT EXISTS unit       TEXT;
ALTER TABLE public.spare_parts ADD COLUMN IF NOT EXISTS cost       NUMERIC;
ALTER TABLE public.spare_parts ADD COLUMN IF NOT EXISTS supplier   TEXT;
ALTER TABLE public.spare_parts ADD COLUMN IF NOT EXISTS category   TEXT;
ALTER TABLE public.spare_parts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ── Clear old data so we can insert fresh ───────────────────
DELETE FROM public.trucks      WHERE tenant_id = 'instaport';
DELETE FROM public.trips       WHERE tenant_id = 'instaport';
DELETE FROM public.spare_parts WHERE tenant_id = 'instaport';
DELETE FROM public.maintenance WHERE tenant_id = 'instaport';

-- ── Seed trucks for instaport ────────────────────────────────
INSERT INTO public.trucks (plate, tenant_id, type, mfr, cooling, status, valid, remark, cal_expiry, flagged) VALUES
('4789 أ ج ي','instaport','Jumbo','Chevrolet','Carrier Oasis 350','Released',true,'','2026-12-01',false),
('4793 أ ج ي','instaport','Jumbo','Chevrolet','Carrier Oasis 350','Released',true,'','2026-11-15',false),
('834 ن ي م','instaport','Jumbo','Chevrolet 2011','Carrier Xarios 500','Hold',false,'Need maintenance','2025-06-01',true),
('ا س ف 367','instaport','Jumbo','Chevrolet 2013','Carrier Xarios 500','Released',true,'Ambient only','2026-10-20',false),
('أ ج ي 5429','instaport','Jumbo','Chevrolet 2013','Carrier Xarios 500','Released',true,'','2026-09-15',false),
('ا ط ف 643','instaport','Jumbo','Chevrolet 2013','Carrier Xarios 500','Released',true,'','2026-12-20',false),
('ف ج ف 517','instaport','Jumbo','Chevrolet 2014','Carrier Xarios 500','Released',true,'','2026-08-07',false),
('ف ج ف 163','instaport','Jumbo','Chevrolet 2014','Carrier Xarios 500','Released',true,'','2027-01-10',false),
('د ل ب 631','instaport','Jumbo','Chevrolet 2014','Carrier Xarios 500','Released',true,'','2026-11-01',false),
('742 ص م ب','instaport','Jumbo','Chevrolet 2016','Top Cold DM 500 F','Released',true,'','2026-10-01',false),
('ع ر ي 826','instaport','Jumbo','Chevrolet 2016','Top Cold DM 500 F','Released',true,'','2026-12-23',false),
('756 ج ن ب','instaport','Jumbo','Chevrolet 2016','Top Cold DM 500 F','Released',true,'','2026-09-01',false),
('628 ه م ب','instaport','Jumbo','Chevrolet 2016','Top Cold DM 500 FP','Released',true,'','2027-01-15',false),
('س ب ي 862','instaport','Jumbo','Chevrolet 2019','Carrier Xarios 500','Released',true,'','2026-08-01',false),
('8537 أ ط و','instaport','Jumbo','Chevrolet 2021','Carrier Xarios 500','Released',true,'Cold+Heating','2027-02-01',false),
('4519 أ ج و','instaport','Jumbo','Chevrolet 2021','Carrier Xarios 500','Released',true,'','2026-10-15',false),
('852 ب أ ن','instaport','Dababa','Chevrolet 2011','ThermoKing C100','Released',true,'','2026-10-02',false),
('أ س ف 495','instaport','Dababa','Chevrolet 2013','Viento V200','Released',true,'','2026-09-07',false),
('د د ف 715','instaport','Dababa','Chevrolet 2014','Carrier Xarios 150','Released',true,'','2026-12-10',false),
('ف ج ف 162','instaport','Dababa','Chevrolet 2014','Carrier Xarios 200','Released',true,'','2026-10-25',false),
('ج ج ف 614','instaport','Dababa','Chevrolet 2014','Carrier Xarios 200','Released',true,'','2026-11-25',false),
('ي س ر 734','instaport','Dababa','Chevrolet 2016','Zanotti Z20s','Released',true,'','2026-09-17',false),
('ا ي ب 567','instaport','Dababa','Chevrolet 2019','Carrier Xarios 200','Released',true,'','2026-06-15',false),
('4916 ا ط و','instaport','Dababa','Chevrolet 2021','Carrier Xarios 200','Released',true,'','2026-03-05',false),
('أ ل ي 6896','instaport','Dababa','Chevrolet 2026','Carrier Xarios 300','Released',true,'','2027-03-01',false),
('158 ب و ل','instaport','Trailer','Chereau 2001','Thermoking SL200','Released',true,'','2027-03-27',false),
('ا م ى 265','instaport','Trailer','Schmitz 2007','Thermoking SL200e','Released',true,'','2026-03-16',false),
('ا ص ي 3175','instaport','Truck Head','Mercedes 2009','-','Released',true,'','2027-06-01',false),
('251 س ص ر','instaport','Truck Head','Mercedes 2009','-','Released',true,'','2027-06-01',false);

-- ── Seed demo trips for instaport ───────────────────────────
INSERT INTO public.trips (id, tenant_id, customer, type, dir, condition, origin, dests, km, cost, co2, truck, driver, status, checklist, quality_pin, attachments, timeline, ts, created_by, price_plan, notes, created_at) VALUES
('TRP-001','instaport','PBG','Outbound','outbound','Cold (2-8C)','Cairo - Obour City','Alexandria',220,4800,63.8,'4789 أ ج ي','Karim Ahmed','completed','[true,true,true,true,true,true,true,true]',true,'[]','[{"ts":"15/05/2026, 08:00:00","user":"Mohammed A.","action":"Trip Created","detail":""},{"ts":"15/05/2026, 17:00:00","user":"Karim Ahmed","action":"Trip Completed","detail":"Delivered successfully"}]','15/05/2026, 08:00:00','5454','','',NOW() - INTERVAL '3 days'),
('TRP-002','instaport','NVS','Outbound','outbound','Frozen (-18C)','Cairo - Obour City','Giza',45,1950,17.1,'4793 أ ج ي','Hassan Ali','completed','[true,true,true,true,true,true,true,true]',true,'[]','[{"ts":"16/05/2026, 07:00:00","user":"Mohammed A.","action":"Trip Created","detail":""},{"ts":"16/05/2026, 12:00:00","user":"Hassan Ali","action":"Trip Completed","detail":""}]','16/05/2026, 07:00:00','5454','','',NOW() - INTERVAL '2 days'),
('TRP-003','instaport','GSK','Outbound','outbound','Cold (2-8C)','Cairo - Obour City','Cairo - Nasr City',18,950,5.2,'ف ج ف 517','Karim Ahmed','in_transit','[true,true,true,true,true,false,false,false]',false,'[]','[{"ts":"18/05/2026, 06:00:00","user":"Mohammed A.","action":"Trip Created","detail":""},{"ts":"18/05/2026, 07:00:00","user":"Alaa A.","action":"Security Approved","detail":"Gate pass issued"}]','18/05/2026, 06:00:00','5454','','',NOW() - INTERVAL '5 hours'),
('TRP-004','instaport','Roche','Outbound','outbound','Cold (2-8C)','Cairo - Obour City','Mansoura',140,3200,40.6,'ا ط ف 643','Hassan Ali','awaiting_security','[true,true,true,true,true,true,true,true]',true,'[]','[{"ts":"18/05/2026, 07:00:00","user":"Mohammed A.","action":"Trip Created","detail":""},{"ts":"18/05/2026, 08:00:00","user":"Mostafa S.","action":"Ctrl Approved","detail":"Gate pass issued"}]','18/05/2026, 07:00:00','5454','','',NOW() - INTERVAL '4 hours'),
('TRP-005','instaport','SND','Outbound','outbound','Ambient (15-25C)','Cairo - Obour City','Cairo - 6th October',35,780,9.0,'ج ج ف 614','Karim Ahmed','awaiting_quality','[false,false,false,false,false,false,false,false]',false,'[]','[{"ts":"18/05/2026, 09:00:00","user":"Mohammed A.","action":"Trip Created","detail":""}]','18/05/2026, 09:00:00','5454','','',NOW() - INTERVAL '2 hours'),
('TRP-006','instaport','PBG','Inbound','inbound','Cold (2-8C)','Alexandria','Cairo - Obour City',220,4800,63.8,'852 ب أ ن','Hassan Ali','awaiting_ctrl','[true,true,true,true,false,false,false,false]',false,'[]','[{"ts":"18/05/2026, 08:00:00","user":"Mohammed A.","action":"Trip Created","detail":""},{"ts":"18/05/2026, 08:30:00","user":"Ahmed G.","action":"Inbound Quality OK","detail":""}]','18/05/2026, 08:00:00','1234','','',NOW() - INTERVAL '3 hours'),
('TRP-007','instaport','SYSMEX','Outbound','outbound','Cold (2-8C)','Cairo - Obour City','Tanta',95,2100,27.6,'أ ج ي 5429','Karim Ahmed','completed','[true,true,true,true,true,true,true,true]',true,'[]','[{"ts":"14/05/2026, 07:00:00","user":"Mohammed A.","action":"Trip Created","detail":""},{"ts":"14/05/2026, 14:00:00","user":"Karim Ahmed","action":"Trip Completed","detail":""}]','14/05/2026, 07:00:00','5454','','',NOW() - INTERVAL '4 days'),
('TRP-008','instaport','KN','Outbound','outbound','Frozen (-18C)','Cairo - Obour City','Port Said',185,4100,70.3,'158 ب و ل','Hassan Ali','completed','[true,true,true,true,true,true,true,true]',true,'[]','[{"ts":"13/05/2026, 06:00:00","user":"Mohammed A.","action":"Trip Created","detail":""},{"ts":"13/05/2026, 16:00:00","user":"Hassan Ali","action":"Trip Completed","detail":""}]','13/05/2026, 06:00:00','5454','','',NOW() - INTERVAL '5 days');

-- ── Seed spare parts for instaport ──────────────────────────
INSERT INTO public.spare_parts (id, tenant_id, name, sku, qty, min_qty, unit, cost, supplier, category) VALUES
('instaport_SP001','instaport','Carrier Xarios 500 - Compressor Belt','CX5-CB-01',5,2,'pcs',850,'Carrier Egypt','Cooling'),
('instaport_SP002','instaport','Temperature Sensor - Eelink TG400','ELK-TS-400',12,3,'pcs',320,'Eelink Tech','Sensors'),
('instaport_SP003','instaport','Door Seal Kit - Jumbo','DSK-JMB-01',8,2,'sets',450,'EPX Supplies','Body'),
('instaport_SP004','instaport','Refrigerant Gas R404A','GAS-R404-5',15,5,'kg',280,'Carrier Egypt','Cooling'),
('instaport_SP005','instaport','Thermoking SL200 - Filter','TK-FL-200',6,2,'pcs',180,'ThermoKing','Cooling'),
('instaport_SP006','instaport','GPS Tracker Battery','GPS-BAT-01',20,5,'pcs',95,'Eelink Tech','Electronics'),
('instaport_SP007','instaport','Dababa Evaporator Coil','DAB-EC-01',3,1,'pcs',1200,'EPX Supplies','Cooling'),
('instaport_SP008','instaport','Engine Oil 15W-40 (4L)','OIL-15W-4',30,10,'cans',220,'Total Egypt','Engine'),
('instaport_SP009','instaport','Air Filter - Chevrolet','AF-CHEV-01',15,4,'pcs',150,'GM Egypt','Engine'),
('instaport_SP010','instaport','Cooling Fan Motor','CFM-UNIV-01',4,1,'pcs',680,'EPX Supplies','Cooling');

-- ── Seed maintenance tickets ─────────────────────────────────
INSERT INTO public.maintenance (id, tenant_id, truck, description, parts, status, ts, attachments, auto, trip_id) VALUES
('MNT-001','instaport','834 ن ي م','Compressor belt worn out — needs replacement','[{"name":"Carrier Xarios 500 - Compressor Belt","qty":1}]','open','15/05/2026, 10:00:00','[]',false,null),
('MNT-002','instaport','ا م ى 265','Annual calibration due — schedule with vendor','[]','open','14/05/2026, 09:00:00','[]',false,null);

-- ── Done ────────────────────────────────────────────────────
-- instaport now has: 29 trucks, 8 trips, 10 spare parts, 2 maintenance tickets
