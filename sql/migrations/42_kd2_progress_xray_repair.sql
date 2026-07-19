-- ================================================================
-- Migration 42: X-ray / repair inspection cycle for KD2 stations
-- flagged as requiring X-ray.
--
-- A completed task at a flagged station isn't truly finished until
-- it passes X-ray inspection — if X-ray finds an issue, the unit
-- goes to repair, then back to X-ray, looping until it passes clean.
-- A failed X-ray reverts completed/completion_date on kd2_progress
-- (actual_start_date is left untouched); a clean pass sets both
-- again automatically.
--
-- xray_cycles logs every attempt:
--   [{ cycle, xray_start, xray_end, result: 'pass'|'fail',
--      repair_start, repair_end }, ...]
-- final_qa_date is set to the xray_end of the cycle that passes.
--
-- requires_xray on kd2_process_stations lets planners choose, per
-- station, whether it goes through this cycle at all (Manage
-- Processes UI) — not hardcoded to a category.
-- ================================================================

ALTER TABLE public.kd2_progress
ADD COLUMN IF NOT EXISTS xray_cycles jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.kd2_progress
ADD COLUMN IF NOT EXISTS final_qa_date date;

ALTER TABLE public.kd2_process_stations
ADD COLUMN IF NOT EXISTS requires_xray boolean NOT NULL DEFAULT false;
