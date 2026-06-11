-- ═══════════════════════════════════════════════════════════════════
-- Migration 36: Reset K10 and K11 process stations (revised)
--
-- Wipes all existing K10/K11 plan and station data and reseeds
-- with the confirmed 38-station process route:
--
--  # │ Station                      │ Work Center   │ L/T │ Category
-- ───┼──────────────────────────────┼───────────────┼─────┼──────────────────────
--  1 │ FLOOR                        │ —             │  4  │ welding
--  2 │ LOWER HULL                   │ W09, W10      │  6  │ welding
--  3 │ HULL MARRIAGE 1ST            │ W30           │  6  │ welding
--  4 │ HULL MARRIAGE 2ND            │ W31, W32      │  6  │ welding
--  5 │ HULL STOWAGE 1ST             │ W33           │  6  │ welding
--  6 │ HULL STOWAGE 2ND             │ W34           │  6  │ welding
--  7 │ HULL FINAL 1ST               │ W35           │  6  │ welding
--  8 │ 1ST QUALIFYING / FORM MOLD   │ —             │  4  │ machining
--  9 │ HULL MACHINING 1ST           │ M03 P/M       │  4  │ machining
-- 10 │ STEAM CLEANING               │ —             │  1  │ shot_blasting_painting
-- 11 │ CARGO MARRIAGE               │ W36 / W38     │  6  │ welding
-- 12 │ CARGO STOWAGE, FINAL 2       │ W37 / W39     │  6  │ welding
-- 13 │ 2ND QUALIFYING               │ —             │  2  │ machining
-- 14 │ CARGO MACHINING 2ND          │ M03 P/M       │  8  │ machining
-- 15 │ DEBURRING                    │ —             │  4  │ shot_blasting_painting
-- 16 │ STEAM CLEANING               │ —             │  2  │ shot_blasting_painting
-- 17 │ FINAL 2ND WELDING            │ —             │  3  │ welding
-- 18 │ INSPECTION                   │ —             │  1  │ shot_blasting_painting
-- 19 │ REPAIR                       │ —             │  1  │ shot_blasting_painting
-- 20 │ SHOT BLASTING                │ —             │  3  │ shot_blasting_painting
-- 21 │ PAINTING                     │ —             │  4  │ shot_blasting_painting
-- 22 │ RE-TAPPING                   │ —             │  3  │ shot_blasting_painting
-- 23 │ SUSPENSION & TRACK Ass'y     │ A1 & A2       │  2  │ assembly
-- 24 │ ELECTRIC/INTERIOR            │ A12           │  5  │ assembly
-- 25 │ ENGINE                       │ A13           │  4  │ assembly
-- 26 │ AUTOMATION SYSTEM            │ A14           │  4  │ assembly
-- 27 │ ADJUSTMENT                   │ A15           │  4  │ assembly
-- 28 │ BREAK-IN AND CHECK           │ —             │  2  │ assembly
-- 29 │ TEST RUN                     │ G1            │  3  │ final_test
-- 30 │ ADJUSTMENT AND INSPECTION    │ Q1            │  3  │ final_test
-- 31 │ REPAIR / CHECK               │ G2            │  3  │ final_test
-- 32 │ Clean / DRY                  │ P1            │  1  │ processing
-- 33 │ Masking                      │ P1            │  1  │ processing
-- 34 │ Sanding                      │ P1            │  1  │ processing
-- 35 │ Painting                     │ P1            │  1  │ processing
-- 36 │ Touch-up                     │ P1            │  1  │ processing
-- 37 │ Attaching                    │ P1            │  2  │ processing
-- 38 │ FINAL CHECK                  │ P2            │  2  │ final_test
--
-- SAFETY: Only K10/K11 data is touched. K9 is not modified.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Remove K10/K11 plan and progress data ─────────────────────
DELETE FROM public.kd2_plan WHERE vehicle_type IN ('K10', 'K11');

-- ─── 2. Remove K10/K11 station reference data ─────────────────────
DELETE FROM public.kd2_process_lead_times WHERE vehicle_type IN ('K10', 'K11');
DELETE FROM public.kd2_process_routes     WHERE vehicle_type IN ('K10', 'K11');
DELETE FROM public.kd2_process_stations   WHERE vehicle_type IN ('K10', 'K11');


-- ─── 3. Insert correct K10 stations ───────────────────────────────
-- route_sequence = position in the full end-to-end process (1-38).
-- station_sequence_in_category = position within the category.

INSERT INTO public.kd2_process_stations
    (vehicle_type, category_code, station_code, station_name, work_center,
     station_sequence_in_category, route_sequence, component_group, notes)
VALUES

-- ── WELDING (seq 1-10, routes 1-7 then 11-12 then 17) ───────────
('K10','welding','k10_floor',
    'FLOOR', null,
    1, 1, 'Hull', null),

('K10','welding','k10_lower_hull',
    'LOWER HULL', 'W09, W10',
    2, 2, 'Hull', null),

('K10','welding','k10_hull_marriage_1st',
    'HULL MARRIAGE 1ST', 'W30',
    3, 3, 'Hull', null),

('K10','welding','k10_hull_marriage_2nd',
    'HULL MARRIAGE 2ND', 'W31, W32',
    4, 4, 'Hull', null),

('K10','welding','k10_hull_stowage_1st',
    'HULL STOWAGE 1ST', 'W33',
    5, 5, 'Hull', null),

('K10','welding','k10_hull_stowage_2nd',
    'HULL STOWAGE 2ND', 'W34',
    6, 6, 'Hull', null),

('K10','welding','k10_hull_final_1st',
    'HULL FINAL 1ST', 'W35',
    7, 7, 'Hull', null),

-- Cargo welding (routes 11-12, after machining/steam cleaning)
('K10','welding','k10_cargo_marriage',
    'CARGO MARRIAGE', 'W36 / W38',
    8, 11, 'Hull', null),

('K10','welding','k10_cargo_stowage',
    'CARGO STOWAGE, FINAL 2', 'W37 / W39',
    9, 12, 'Hull', null),

-- Final 2nd welding (route 17, after second steam cleaning)
('K10','welding','k10_final_weld_2nd',
    'FINAL 2ND WELDING', null,
    10, 17, 'Hull', null),

-- ── MACHINING (seq 1-4, routes 8-9 then 13-14) ───────────────────
('K10','machining','k10_1st_qualifying',
    '1ST QUALIFYING / FORM MOLDING', null,
    1, 8, 'Hull', null),

('K10','machining','k10_hull_machining_1st',
    'HULL MACHINING 1ST', 'M03 P/M',
    2, 9, 'Hull', null),

('K10','machining','k10_2nd_qualifying',
    '2ND QUALIFYING', null,
    3, 13, 'Hull', null),

('K10','machining','k10_cargo_machining_2nd',
    'CARGO MACHINING 2ND', 'M03 P/M',
    4, 14, 'Hull', null),

-- ── SHOT BLASTING & PAINTING (seq 1-8, routes 10,15-16,18-22) ────
('K10','shot_blasting_painting','k10_steam_cleaning_1',
    'STEAM CLEANING', null,
    1, 10, 'Hull', null),

('K10','shot_blasting_painting','k10_deburring',
    'DEBURRING', null,
    2, 15, 'Hull', null),

('K10','shot_blasting_painting','k10_steam_cleaning_2',
    'STEAM CLEANING', null,
    3, 16, 'Hull', null),

('K10','shot_blasting_painting','k10_inspection',
    'INSPECTION', null,
    4, 18, 'Hull', null),

('K10','shot_blasting_painting','k10_repair_sbp',
    'REPAIR', null,
    5, 19, 'Hull', null),

('K10','shot_blasting_painting','k10_shot_blasting',
    'SHOT BLASTING', null,
    6, 20, 'Hull', null),

('K10','shot_blasting_painting','k10_painting',
    'PAINTING', null,
    7, 21, 'Hull', null),

('K10','shot_blasting_painting','k10_re_tapping',
    'RE-TAPPING', null,
    8, 22, 'Hull', null),

-- ── ASSEMBLY (seq 1-6, routes 23-28) ─────────────────────────────
('K10','assembly','k10_assembly_suspension_track',
    'SUSPENSION & TRACK Ass''y', 'A1 & A2',
    1, 23, 'Assembly & Processing and Testing', null),

('K10','assembly','k10_assembly_electric_interior',
    'ELECTRIC/INTERIOR', 'A12',
    2, 24, 'Assembly & Processing and Testing', null),

('K10','assembly','k10_assembly_engine',
    'ENGINE', 'A13',
    3, 25, 'Assembly & Processing and Testing', null),

('K10','assembly','k10_assembly_automation',
    'AUTOMATION SYSTEM', 'A14',
    4, 26, 'Assembly & Processing and Testing', null),

('K10','assembly','k10_assembly_adjustment',
    'ADJUSTMENT', 'A15',
    5, 27, 'Assembly & Processing and Testing', null),

('K10','assembly','k10_assembly_break_in',
    'BREAK-IN AND CHECK', null,
    6, 28, 'Assembly & Processing and Testing', null),

-- ── FINAL TEST (seq 1-4, routes 29-31 then 38) ───────────────────
('K10','final_test','k10_final_test_run',
    'TEST RUN', 'G1',
    1, 29, 'Assembly & Processing and Testing', null),

('K10','final_test','k10_final_test_adj_insp',
    'ADJUSTMENT AND INSPECTION', 'Q1',
    2, 30, 'Assembly & Processing and Testing', null),

('K10','final_test','k10_final_test_repair_check',
    'REPAIR / CHECK', 'G2',
    3, 31, 'Assembly & Processing and Testing', null),

('K10','final_test','k10_final_check',
    'FINAL CHECK', 'P2',
    4, 38, 'Assembly & Processing and Testing', null),

-- ── PROCESSING / P1 (seq 1-6, routes 32-37) ─────────────────────
('K10','processing','k10_processing_clean_dry',
    'Clean / DRY', 'P1',
    1, 32, 'Assembly & Processing and Testing', null),

('K10','processing','k10_processing_masking',
    'Masking', 'P1',
    2, 33, 'Assembly & Processing and Testing', null),

('K10','processing','k10_processing_sanding',
    'Sanding', 'P1',
    3, 34, 'Assembly & Processing and Testing', null),

('K10','processing','k10_processing_painting',
    'Painting', 'P1',
    4, 35, 'Assembly & Processing and Testing', null),

('K10','processing','k10_processing_touch_up',
    'Touch-up', 'P1',
    5, 36, 'Assembly & Processing and Testing', null),

('K10','processing','k10_processing_attaching',
    'Attaching', 'P1',
    6, 37, 'Assembly & Processing and Testing', null);


-- ─── 4. Insert correct K11 stations (identical structure) ─────────
INSERT INTO public.kd2_process_stations
    (vehicle_type, category_code, station_code, station_name, work_center,
     station_sequence_in_category, route_sequence, component_group, notes)
VALUES

('K11','welding','k11_floor',
    'FLOOR', null, 1, 1, 'Hull', null),
('K11','welding','k11_lower_hull',
    'LOWER HULL', 'W09, W10', 2, 2, 'Hull', null),
('K11','welding','k11_hull_marriage_1st',
    'HULL MARRIAGE 1ST', 'W30', 3, 3, 'Hull', null),
('K11','welding','k11_hull_marriage_2nd',
    'HULL MARRIAGE 2ND', 'W31, W32', 4, 4, 'Hull', null),
('K11','welding','k11_hull_stowage_1st',
    'HULL STOWAGE 1ST', 'W33', 5, 5, 'Hull', null),
('K11','welding','k11_hull_stowage_2nd',
    'HULL STOWAGE 2ND', 'W34', 6, 6, 'Hull', null),
('K11','welding','k11_hull_final_1st',
    'HULL FINAL 1ST', 'W35', 7, 7, 'Hull', null),
('K11','welding','k11_cargo_marriage',
    'CARGO MARRIAGE', 'W36 / W38', 8, 11, 'Hull', null),
('K11','welding','k11_cargo_stowage',
    'CARGO STOWAGE, FINAL 2', 'W37 / W39', 9, 12, 'Hull', null),
('K11','welding','k11_final_weld_2nd',
    'FINAL 2ND WELDING', null, 10, 17, 'Hull', null),

('K11','machining','k11_1st_qualifying',
    '1ST QUALIFYING / FORM MOLDING', null, 1, 8, 'Hull', null),
('K11','machining','k11_hull_machining_1st',
    'HULL MACHINING 1ST', 'M03 P/M', 2, 9, 'Hull', null),
('K11','machining','k11_2nd_qualifying',
    '2ND QUALIFYING', null, 3, 13, 'Hull', null),
('K11','machining','k11_cargo_machining_2nd',
    'CARGO MACHINING 2ND', 'M03 P/M', 4, 14, 'Hull', null),

('K11','shot_blasting_painting','k11_steam_cleaning_1',
    'STEAM CLEANING', null, 1, 10, 'Hull', null),
('K11','shot_blasting_painting','k11_deburring',
    'DEBURRING', null, 2, 15, 'Hull', null),
('K11','shot_blasting_painting','k11_steam_cleaning_2',
    'STEAM CLEANING', null, 3, 16, 'Hull', null),
('K11','shot_blasting_painting','k11_inspection',
    'INSPECTION', null, 4, 18, 'Hull', null),
('K11','shot_blasting_painting','k11_repair_sbp',
    'REPAIR', null, 5, 19, 'Hull', null),
('K11','shot_blasting_painting','k11_shot_blasting',
    'SHOT BLASTING', null, 6, 20, 'Hull', null),
('K11','shot_blasting_painting','k11_painting',
    'PAINTING', null, 7, 21, 'Hull', null),
('K11','shot_blasting_painting','k11_re_tapping',
    'RE-TAPPING', null, 8, 22, 'Hull', null),

('K11','assembly','k11_assembly_suspension_track',
    'SUSPENSION & TRACK Ass''y', 'A1 & A2', 1, 23, 'Assembly & Processing and Testing', null),
('K11','assembly','k11_assembly_electric_interior',
    'ELECTRIC/INTERIOR', 'A12', 2, 24, 'Assembly & Processing and Testing', null),
('K11','assembly','k11_assembly_engine',
    'ENGINE', 'A13', 3, 25, 'Assembly & Processing and Testing', null),
('K11','assembly','k11_assembly_automation',
    'AUTOMATION SYSTEM', 'A14', 4, 26, 'Assembly & Processing and Testing', null),
('K11','assembly','k11_assembly_adjustment',
    'ADJUSTMENT', 'A15', 5, 27, 'Assembly & Processing and Testing', null),
('K11','assembly','k11_assembly_break_in',
    'BREAK-IN AND CHECK', null, 6, 28, 'Assembly & Processing and Testing', null),

('K11','final_test','k11_final_test_run',
    'TEST RUN', 'G1', 1, 29, 'Assembly & Processing and Testing', null),
('K11','final_test','k11_final_test_adj_insp',
    'ADJUSTMENT AND INSPECTION', 'Q1', 2, 30, 'Assembly & Processing and Testing', null),
('K11','final_test','k11_final_test_repair_check',
    'REPAIR / CHECK', 'G2', 3, 31, 'Assembly & Processing and Testing', null),
('K11','final_test','k11_final_check',
    'FINAL CHECK', 'P2', 4, 38, 'Assembly & Processing and Testing', null),

('K11','processing','k11_processing_clean_dry',
    'Clean / DRY', 'P1', 1, 32, 'Assembly & Processing and Testing', null),
('K11','processing','k11_processing_masking',
    'Masking', 'P1', 2, 33, 'Assembly & Processing and Testing', null),
('K11','processing','k11_processing_sanding',
    'Sanding', 'P1', 3, 34, 'Assembly & Processing and Testing', null),
('K11','processing','k11_processing_painting',
    'Painting', 'P1', 4, 35, 'Assembly & Processing and Testing', null),
('K11','processing','k11_processing_touch_up',
    'Touch-up', 'P1', 5, 36, 'Assembly & Processing and Testing', null),
('K11','processing','k11_processing_attaching',
    'Attaching', 'P1', 6, 37, 'Assembly & Processing and Testing', null);


-- ─── 5. Sync kd2_process_routes ───────────────────────────────────
INSERT INTO public.kd2_process_routes (vehicle_type, category_code, station_code, route_sequence)
SELECT vehicle_type, category_code, station_code, route_sequence
FROM public.kd2_process_stations
WHERE vehicle_type IN ('K10', 'K11')
ON CONFLICT (vehicle_type, station_code) DO UPDATE SET
    category_code  = excluded.category_code,
    route_sequence = excluded.route_sequence,
    is_active      = true;


-- ─── 6. Seed confirmed lead times ─────────────────────────────────
INSERT INTO public.kd2_process_lead_times
    (vehicle_type, category_code, station_code, planning_level, lead_time_days, notes)
SELECT s.vehicle_type, s.category_code, s.station_code, 'station',
       lt.days, null
FROM public.kd2_process_stations s
JOIN (VALUES
    ('k10_floor',                         4),
    ('k10_lower_hull',                    6),
    ('k10_hull_marriage_1st',             6),
    ('k10_hull_marriage_2nd',             6),
    ('k10_hull_stowage_1st',              6),
    ('k10_hull_stowage_2nd',              6),
    ('k10_hull_final_1st',                6),
    ('k10_1st_qualifying',                4),
    ('k10_hull_machining_1st',            4),
    ('k10_steam_cleaning_1',              1),
    ('k10_cargo_marriage',                6),
    ('k10_cargo_stowage',                 6),
    ('k10_2nd_qualifying',                2),
    ('k10_cargo_machining_2nd',           8),
    ('k10_deburring',                     4),
    ('k10_steam_cleaning_2',              2),
    ('k10_final_weld_2nd',                3),
    ('k10_inspection',                    1),
    ('k10_repair_sbp',                    1),
    ('k10_shot_blasting',                 3),
    ('k10_painting',                      4),
    ('k10_re_tapping',                    3),
    ('k10_assembly_suspension_track',     2),
    ('k10_assembly_electric_interior',    5),
    ('k10_assembly_engine',               4),
    ('k10_assembly_automation',           4),
    ('k10_assembly_adjustment',           4),
    ('k10_assembly_break_in',             2),
    ('k10_final_test_run',                3),
    ('k10_final_test_adj_insp',           3),
    ('k10_final_test_repair_check',       3),
    ('k10_processing_clean_dry',          1),
    ('k10_processing_masking',            1),
    ('k10_processing_sanding',            1),
    ('k10_processing_painting',           1),
    ('k10_processing_touch_up',           1),
    ('k10_processing_attaching',          2),
    ('k10_final_check',                   2)
) AS lt(code, days) ON s.station_code = lt.code
WHERE s.vehicle_type = 'K10'
ON CONFLICT (vehicle_type, category_code, station_code, planning_level) DO UPDATE
    SET lead_time_days = excluded.lead_time_days;

-- K11 lead times are identical
INSERT INTO public.kd2_process_lead_times
    (vehicle_type, category_code, station_code, planning_level, lead_time_days, notes)
SELECT s.vehicle_type, s.category_code, s.station_code, 'station',
       lt.days, null
FROM public.kd2_process_stations s
JOIN (VALUES
    ('k11_floor',                         4),
    ('k11_lower_hull',                    6),
    ('k11_hull_marriage_1st',             6),
    ('k11_hull_marriage_2nd',             6),
    ('k11_hull_stowage_1st',              6),
    ('k11_hull_stowage_2nd',              6),
    ('k11_hull_final_1st',                6),
    ('k11_1st_qualifying',                4),
    ('k11_hull_machining_1st',            4),
    ('k11_steam_cleaning_1',              1),
    ('k11_cargo_marriage',                6),
    ('k11_cargo_stowage',                 6),
    ('k11_2nd_qualifying',                2),
    ('k11_cargo_machining_2nd',           8),
    ('k11_deburring',                     4),
    ('k11_steam_cleaning_2',              2),
    ('k11_final_weld_2nd',                3),
    ('k11_inspection',                    1),
    ('k11_repair_sbp',                    1),
    ('k11_shot_blasting',                 3),
    ('k11_painting',                      4),
    ('k11_re_tapping',                    3),
    ('k11_assembly_suspension_track',     2),
    ('k11_assembly_electric_interior',    5),
    ('k11_assembly_engine',               4),
    ('k11_assembly_automation',           4),
    ('k11_assembly_adjustment',           4),
    ('k11_assembly_break_in',             2),
    ('k11_final_test_run',                3),
    ('k11_final_test_adj_insp',           3),
    ('k11_final_test_repair_check',       3),
    ('k11_processing_clean_dry',          1),
    ('k11_processing_masking',            1),
    ('k11_processing_sanding',            1),
    ('k11_processing_painting',           1),
    ('k11_processing_touch_up',           1),
    ('k11_processing_attaching',          2),
    ('k11_final_check',                   2)
) AS lt(code, days) ON s.station_code = lt.code
WHERE s.vehicle_type = 'K11'
ON CONFLICT (vehicle_type, category_code, station_code, planning_level) DO UPDATE
    SET lead_time_days = excluded.lead_time_days;


COMMIT;
