-- 47_fix_kd2_route_order.sql
--
-- Two data fixes for the KD2 process route, both matched by station_code so
-- this is safe to re-run:
--
-- 1. K9 downstream (Assembly / Processing / Final Test) route_sequence did not
--    match the master schedule. The hull-side assembly (A2/A3/A4) and
--    turret-side assembly (A8/A9/A10) shared route numbers, so they
--    interleaved; and Processing (P1) sorted before the #1 Inspection /
--    Test Run / Adjustment steps. Renumber the downstream block to the
--    master-schedule order:
--      A1 Suspension → A2 Electric → A3 Interior → A4 Engine →
--      A8 Turret Ammo Rack → A9 Turret Door/Electric → A10 Turret Hydraulic →
--      A11 Gun Barrel Sub → A5 Turret/Gun Marriage → A6 Hydraulic System →
--      A7 Bore-sighting → G1 #1 Inspection → Q1 Test Run →
--      G2 Adjustment & Inspection → P1 Clean/Dry → Masking → Sanding →
--      Painting → Touch-up → Attaching → P2 Final Check
--    (K9 Hull and Turret route_sequence are already correct and untouched.)
--
-- 2. K10/K11 structure stations were tagged component_group = 'Hull' (a
--    leftover from copying the K9 template — K10/K11 have no Hull/Turret
--    split). Retag them 'Structure'. Cosmetic only: the app groups K10/K11
--    by category, not component_group.
--
-- Existing kd2_plan rows keep their own frozen route_sequence snapshot; the
-- Plan Data table, reports, Gantt and VPX all resolve order from the live
-- station config by station_code, so this migration is enough.
begin;

-- ── 1. K9 downstream route_sequence ──────────────────────────────
update public.kd2_process_stations s
set route_sequence = v.seq
from (values
    ('k9_assembly_suspension',        20),
    ('k9_assembly_h_electric',        21),
    ('k9_assembly_interior',          22),
    ('k9_assembly_engine',            23),
    ('k9_assembly_turret',            24),
    ('k9_assembly_t_electric_turret', 25),
    ('k9_assembly_hyd_sub_turret',    26),
    ('k9_assembly_gun_barrel',        27),
    ('k9_assembly_turret_gun',        28),
    ('k9_assembly_hydraulic',         29),
    ('k9_assembly_bore_sight',        30),
    ('k9_final_test_1insp',           31),
    ('k9_final_test_test_run',        32),
    ('k9_final_test_performance_test', 33),
    ('k9_processing_clean_dry',       34),
    ('k9_processing_masking',         35),
    ('k9_processing_sanding',         36),
    ('k9_processing_painting',        37),
    ('k9_processing_touch_up',        38),
    ('k9_processing_attaching',       39),
    ('k9_final_test_final_check',     40)
) as v(code, seq)
where s.vehicle_type = 'K9' and s.station_code = v.code;

-- keep the routes table in sync
update public.kd2_process_routes r
set route_sequence = s.route_sequence
from public.kd2_process_stations s
where r.vehicle_type = s.vehicle_type
  and r.station_code = s.station_code
  and s.vehicle_type = 'K9'
  and s.station_code in (
    'k9_assembly_suspension','k9_assembly_h_electric','k9_assembly_interior',
    'k9_assembly_engine','k9_assembly_turret','k9_assembly_t_electric_turret',
    'k9_assembly_hyd_sub_turret','k9_assembly_gun_barrel','k9_assembly_turret_gun',
    'k9_assembly_hydraulic','k9_assembly_bore_sight','k9_final_test_1insp',
    'k9_final_test_test_run','k9_final_test_performance_test','k9_processing_clean_dry',
    'k9_processing_masking','k9_processing_sanding','k9_processing_painting',
    'k9_processing_touch_up','k9_processing_attaching','k9_final_test_final_check'
  );

-- ── 2. K10/K11 structure component_group ─────────────────────────
update public.kd2_process_stations
set component_group = 'Structure'
where vehicle_type in ('K10', 'K11')
  and category_code in ('welding', 'machining', 'shot_blasting_painting', 'rt')
  and (component_group is distinct from 'Structure');

update public.kd2_process_stations
set component_group = 'Assembly & Processing & Testing'
where vehicle_type in ('K10', 'K11')
  and category_code in ('assembly', 'processing', 'final_test')
  and (component_group is distinct from 'Assembly & Processing & Testing');

commit;
