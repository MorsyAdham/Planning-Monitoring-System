-- ═══════════════════════════════════════════════════════════════════
-- Migration 36: Reset K10 and K11 process stations from scratch
--
-- The previous K10/K11 station data was placeholder / incorrect.
-- This migration:
--   1. Deletes all K10/K11 plan, progress, lead-time, route and
--      station rows.
--   2. Inserts the correct station list for both K10 and K11 based
--      on the confirmed process sheet:
--
--      Welding (1-14):
--        FLOOR → LOWER HULL x2 (W09/W10) → HULL MARRIAGE 1ST (W30)
--        → HULL MARRIAGE 2ND x2 (W31/W32) → HULL STOWAGE 1ST (W33)
--        → HULL STOWAGE 2ND (W34) → HULL FINAL 1ST (W35)
--        → CARGO MARRIAGE x2 (W36/W38) → CARGO STOWAGE FINAL 2 x2 (W37/W39)
--        → FINAL 2ND WELDING
--      Machining (1-5):
--        1ST QUALIFYING → HULL MACHINING 1ST x2 (M03 P/M)
--        → 2ND QUALIFYING → CARGO MACHINING 2ND (M03 P/M)
--      Shot Blasting & Painting (1-8):
--        STEAM CLEANING → DEBURRING → STEAM CLEANING → INSPECTION
--        → REPAIR → SHOT BLASTING → PAINTING → RE-TAPPING
--      Assembly (1-6):
--        SUSPENSION & TRACK → ELECTRIC/INTERIOR → ENGINE
--        → AUTOMATION SYSTEM → ADJUSTMENT → BREAK-IN AND CHECK
--      Final Test (1-4):
--        TEST RUN (G1) → ADJUSTMENT AND INSPECTION (Q1)
--        → REPAIR / CHECK (G2) → FINAL CHECK (P2)
--      Processing (1-6):
--        Clean/DRY → Masking → Sanding → Painting → Touch-up → Attaching
--
--   3. Syncs kd2_process_routes and seeds kd2_process_lead_times.
--
-- SAFETY: Only K10/K11 data is touched. K9 is not modified.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Remove K10/K11 plan and progress data ─────────────────────
-- kd2_progress cascades from kd2_plan, so only plan delete needed.
DELETE FROM public.kd2_plan
WHERE vehicle_type IN ('K10', 'K11');

-- ─── 2. Remove K10/K11 station reference data ─────────────────────
DELETE FROM public.kd2_process_lead_times WHERE vehicle_type IN ('K10', 'K11');
DELETE FROM public.kd2_process_routes     WHERE vehicle_type IN ('K10', 'K11');
DELETE FROM public.kd2_process_stations   WHERE vehicle_type IN ('K10', 'K11');


-- ─── 3. Insert correct K10 stations ───────────────────────────────
-- Route sequence reflects full process order (interleaved across
-- categories where welding and machining/SBP steps alternate).

INSERT INTO public.kd2_process_stations
    (vehicle_type, category_code, station_code, station_name, work_center,
     station_sequence_in_category, route_sequence, component_group, notes)
VALUES

-- ── WELDING ──────────────────────────────────────────────────────
('K10','welding','k10_floor',
    'FLOOR', null, 1, 1, 'Hull', 'Work center TBD'),

('K10','welding','k10_lower_hull_w09',
    'LOWER HULL', 'W09', 2, 2, 'Hull', null),
('K10','welding','k10_lower_hull_w10',
    'LOWER HULL', 'W10', 3, 3, 'Hull', 'Parallel RT station'),

('K10','welding','k10_hull_marriage_1st',
    'HULL MARRIAGE 1ST', 'W30', 4, 4, 'Hull', null),

('K10','welding','k10_hull_marriage_2nd_w31',
    'HULL MARRIAGE 2ND', 'W31', 5, 5, 'Hull', null),
('K10','welding','k10_hull_marriage_2nd_w32',
    'HULL MARRIAGE 2ND', 'W32', 6, 6, 'Hull', 'Parallel RT station'),

('K10','welding','k10_hull_stowage_1st',
    'HULL STOWAGE 1ST', 'W33', 7, 7, 'Hull', null),

('K10','welding','k10_hull_stowage_2nd',
    'HULL STOWAGE 2ND', 'W34', 8, 8, 'Hull', null),

('K10','welding','k10_hull_final_1st',
    'HULL FINAL 1ST', 'W35', 9, 9, 'Hull', null),

-- Cargo welding (route 14-17, interleaved after machining/SBP steps)
('K10','welding','k10_cargo_marriage_w36',
    'CARGO MARRIAGE', 'W36', 10, 14, 'Hull', null),
('K10','welding','k10_cargo_marriage_w38',
    'CARGO MARRIAGE', 'W38', 11, 15, 'Hull', 'Parallel station'),

('K10','welding','k10_cargo_stowage_w37',
    'CARGO STOWAGE, FINAL 2', 'W37', 12, 16, 'Hull', null),
('K10','welding','k10_cargo_stowage_w39',
    'CARGO STOWAGE, FINAL 2', 'W39', 13, 17, 'Hull', 'Parallel station'),

-- Final 2nd welding comes after deburring/steam cleaning (route 22)
('K10','welding','k10_final_weld_2nd',
    'FINAL 2ND WELDING', null, 14, 22, 'Hull', null),

-- ── MACHINING ─────────────────────────────────────────────────────
('K10','machining','k10_1st_qualifying',
    '1ST QUALIFYING / FORM MOLDING', null, 1, 10, 'Hull', null),

('K10','machining','k10_hull_machining_1st_a',
    'HULL MACHINING 1ST', 'M03 P/M', 2, 11, 'Hull', null),
('K10','machining','k10_hull_machining_1st_b',
    'HULL MACHINING 1ST', 'M03 P/M', 3, 12, 'Hull', 'Parallel M03 station'),

('K10','machining','k10_2nd_qualifying',
    '2ND QUALIFYING', null, 4, 18, 'Hull', null),

('K10','machining','k10_cargo_machining_2nd',
    'CARGO MACHINING 2ND', 'M03 P/M', 5, 19, 'Hull', null),

-- ── SHOT BLASTING & PAINTING ──────────────────────────────────────
-- seq 1: Steam Cleaning (after hull machining, route 13)
('K10','shot_blasting_painting','k10_steam_cleaning_1',
    'STEAM CLEANING', null, 1, 13, 'Hull', null),

-- seq 2-3: Deburring + Steam Cleaning (after cargo machining, routes 20-21)
('K10','shot_blasting_painting','k10_deburring',
    'DEBURRING', null, 2, 20, 'Hull', null),
('K10','shot_blasting_painting','k10_steam_cleaning_2',
    'STEAM CLEANING', null, 3, 21, 'Hull', null),

-- seq 4-8: Inspection through Re-tapping (routes 23-27)
('K10','shot_blasting_painting','k10_inspection',
    'INSPECTION', null, 4, 23, 'Hull', null),
('K10','shot_blasting_painting','k10_repair_sbp',
    'REPAIR', null, 5, 24, 'Hull', null),
('K10','shot_blasting_painting','k10_shot_blasting',
    'SHOT BLASTING', null, 6, 25, 'Hull', null),
('K10','shot_blasting_painting','k10_painting',
    'PAINTING', null, 7, 26, 'Hull', null),
('K10','shot_blasting_painting','k10_re_tapping',
    'RE-TAPPING', null, 8, 27, 'Hull', null),

-- ── ASSEMBLY ──────────────────────────────────────────────────────
('K10','assembly','k10_assembly_suspension_track',
    'SUSPENSION & TRACK Ass''y', 'A1 & A2', 1, 28, 'Assembly & Processing and Testing', null),
('K10','assembly','k10_assembly_electric_interior',
    'ELECTRIC/INTERIOR', 'A12', 2, 29, 'Assembly & Processing and Testing', null),
('K10','assembly','k10_assembly_engine',
    'ENGINE', 'A13', 3, 30, 'Assembly & Processing and Testing', null),
('K10','assembly','k10_assembly_automation',
    'AUTOMATION SYSTEM', 'A14', 4, 31, 'Assembly & Processing and Testing', null),
('K10','assembly','k10_assembly_adjustment',
    'ADJUSTMENT', 'A15', 5, 32, 'Assembly & Processing and Testing', null),
('K10','assembly','k10_assembly_break_in',
    'BREAK-IN AND CHECK', null, 6, 33, 'Assembly & Processing and Testing', null),

-- ── FINAL TEST ────────────────────────────────────────────────────
('K10','final_test','k10_final_test_run',
    'TEST RUN', 'G1', 1, 34, 'Assembly & Processing and Testing', null),
('K10','final_test','k10_final_test_adj_insp',
    'ADJUSTMENT AND INSPECTION', 'Q1', 2, 35, 'Assembly & Processing and Testing', null),
('K10','final_test','k10_final_test_repair_check',
    'REPAIR / CHECK', 'G2', 3, 36, 'Assembly & Processing and Testing', null),

-- ── PROCESSING (P1) ───────────────────────────────────────────────
('K10','processing','k10_processing_clean_dry',
    'Clean / DRY', 'P1', 1, 37, 'Assembly & Processing and Testing', null),
('K10','processing','k10_processing_masking',
    'Masking', 'P1', 2, 38, 'Assembly & Processing and Testing', null),
('K10','processing','k10_processing_sanding',
    'Sanding', 'P1', 3, 39, 'Assembly & Processing and Testing', null),
('K10','processing','k10_processing_painting',
    'Painting', 'P1', 4, 40, 'Assembly & Processing and Testing', null),
('K10','processing','k10_processing_touch_up',
    'Touch-up', 'P1', 5, 41, 'Assembly & Processing and Testing', null),
('K10','processing','k10_processing_attaching',
    'Attaching', 'P1', 6, 42, 'Assembly & Processing and Testing', null),

-- ── FINAL CHECK (P2) — sits in final_test, after processing ───────
('K10','final_test','k10_final_check',
    'FINAL CHECK', 'P2', 4, 43, 'Assembly & Processing and Testing', null);


-- ─── 4. Insert correct K11 stations (identical structure) ─────────
INSERT INTO public.kd2_process_stations
    (vehicle_type, category_code, station_code, station_name, work_center,
     station_sequence_in_category, route_sequence, component_group, notes)
VALUES

('K11','welding','k11_floor',
    'FLOOR', null, 1, 1, 'Hull', 'Work center TBD'),
('K11','welding','k11_lower_hull_w09',
    'LOWER HULL', 'W09', 2, 2, 'Hull', null),
('K11','welding','k11_lower_hull_w10',
    'LOWER HULL', 'W10', 3, 3, 'Hull', 'Parallel RT station'),
('K11','welding','k11_hull_marriage_1st',
    'HULL MARRIAGE 1ST', 'W30', 4, 4, 'Hull', null),
('K11','welding','k11_hull_marriage_2nd_w31',
    'HULL MARRIAGE 2ND', 'W31', 5, 5, 'Hull', null),
('K11','welding','k11_hull_marriage_2nd_w32',
    'HULL MARRIAGE 2ND', 'W32', 6, 6, 'Hull', 'Parallel RT station'),
('K11','welding','k11_hull_stowage_1st',
    'HULL STOWAGE 1ST', 'W33', 7, 7, 'Hull', null),
('K11','welding','k11_hull_stowage_2nd',
    'HULL STOWAGE 2ND', 'W34', 8, 8, 'Hull', null),
('K11','welding','k11_hull_final_1st',
    'HULL FINAL 1ST', 'W35', 9, 9, 'Hull', null),
('K11','welding','k11_cargo_marriage_w36',
    'CARGO MARRIAGE', 'W36', 10, 14, 'Hull', null),
('K11','welding','k11_cargo_marriage_w38',
    'CARGO MARRIAGE', 'W38', 11, 15, 'Hull', 'Parallel station'),
('K11','welding','k11_cargo_stowage_w37',
    'CARGO STOWAGE, FINAL 2', 'W37', 12, 16, 'Hull', null),
('K11','welding','k11_cargo_stowage_w39',
    'CARGO STOWAGE, FINAL 2', 'W39', 13, 17, 'Hull', 'Parallel station'),
('K11','welding','k11_final_weld_2nd',
    'FINAL 2ND WELDING', null, 14, 22, 'Hull', null),

('K11','machining','k11_1st_qualifying',
    '1ST QUALIFYING / FORM MOLDING', null, 1, 10, 'Hull', null),
('K11','machining','k11_hull_machining_1st_a',
    'HULL MACHINING 1ST', 'M03 P/M', 2, 11, 'Hull', null),
('K11','machining','k11_hull_machining_1st_b',
    'HULL MACHINING 1ST', 'M03 P/M', 3, 12, 'Hull', 'Parallel M03 station'),
('K11','machining','k11_2nd_qualifying',
    '2ND QUALIFYING', null, 4, 18, 'Hull', null),
('K11','machining','k11_cargo_machining_2nd',
    'CARGO MACHINING 2ND', 'M03 P/M', 5, 19, 'Hull', null),

('K11','shot_blasting_painting','k11_steam_cleaning_1',
    'STEAM CLEANING', null, 1, 13, 'Hull', null),
('K11','shot_blasting_painting','k11_deburring',
    'DEBURRING', null, 2, 20, 'Hull', null),
('K11','shot_blasting_painting','k11_steam_cleaning_2',
    'STEAM CLEANING', null, 3, 21, 'Hull', null),
('K11','shot_blasting_painting','k11_inspection',
    'INSPECTION', null, 4, 23, 'Hull', null),
('K11','shot_blasting_painting','k11_repair_sbp',
    'REPAIR', null, 5, 24, 'Hull', null),
('K11','shot_blasting_painting','k11_shot_blasting',
    'SHOT BLASTING', null, 6, 25, 'Hull', null),
('K11','shot_blasting_painting','k11_painting',
    'PAINTING', null, 7, 26, 'Hull', null),
('K11','shot_blasting_painting','k11_re_tapping',
    'RE-TAPPING', null, 8, 27, 'Hull', null),

('K11','assembly','k11_assembly_suspension_track',
    'SUSPENSION & TRACK Ass''y', 'A1 & A2', 1, 28, 'Assembly & Processing and Testing', null),
('K11','assembly','k11_assembly_electric_interior',
    'ELECTRIC/INTERIOR', 'A12', 2, 29, 'Assembly & Processing and Testing', null),
('K11','assembly','k11_assembly_engine',
    'ENGINE', 'A13', 3, 30, 'Assembly & Processing and Testing', null),
('K11','assembly','k11_assembly_automation',
    'AUTOMATION SYSTEM', 'A14', 4, 31, 'Assembly & Processing and Testing', null),
('K11','assembly','k11_assembly_adjustment',
    'ADJUSTMENT', 'A15', 5, 32, 'Assembly & Processing and Testing', null),
('K11','assembly','k11_assembly_break_in',
    'BREAK-IN AND CHECK', null, 6, 33, 'Assembly & Processing and Testing', null),

('K11','final_test','k11_final_test_run',
    'TEST RUN', 'G1', 1, 34, 'Assembly & Processing and Testing', null),
('K11','final_test','k11_final_test_adj_insp',
    'ADJUSTMENT AND INSPECTION', 'Q1', 2, 35, 'Assembly & Processing and Testing', null),
('K11','final_test','k11_final_test_repair_check',
    'REPAIR / CHECK', 'G2', 3, 36, 'Assembly & Processing and Testing', null),

('K11','processing','k11_processing_clean_dry',
    'Clean / DRY', 'P1', 1, 37, 'Assembly & Processing and Testing', null),
('K11','processing','k11_processing_masking',
    'Masking', 'P1', 2, 38, 'Assembly & Processing and Testing', null),
('K11','processing','k11_processing_sanding',
    'Sanding', 'P1', 3, 39, 'Assembly & Processing and Testing', null),
('K11','processing','k11_processing_painting',
    'Painting', 'P1', 4, 40, 'Assembly & Processing and Testing', null),
('K11','processing','k11_processing_touch_up',
    'Touch-up', 'P1', 5, 41, 'Assembly & Processing and Testing', null),
('K11','processing','k11_processing_attaching',
    'Attaching', 'P1', 6, 42, 'Assembly & Processing and Testing', null),

('K11','final_test','k11_final_check',
    'FINAL CHECK', 'P2', 4, 43, 'Assembly & Processing and Testing', null);


-- ─── 5. Sync kd2_process_routes ───────────────────────────────────
INSERT INTO public.kd2_process_routes (vehicle_type, category_code, station_code, route_sequence)
SELECT vehicle_type, category_code, station_code, route_sequence
FROM public.kd2_process_stations
WHERE vehicle_type IN ('K10', 'K11')
ON CONFLICT (vehicle_type, station_code) DO UPDATE SET
    category_code  = excluded.category_code,
    route_sequence = excluded.route_sequence,
    is_active      = true;


-- ─── 6. Seed lead times (null — to be confirmed) ──────────────────
INSERT INTO public.kd2_process_lead_times
    (vehicle_type, category_code, station_code, planning_level, lead_time_days, notes)
SELECT vehicle_type, category_code, station_code, 'station', null,
       'Pending confirmation'
FROM public.kd2_process_stations
WHERE vehicle_type IN ('K10', 'K11')
ON CONFLICT (vehicle_type, category_code, station_code, planning_level) DO NOTHING;


COMMIT;
