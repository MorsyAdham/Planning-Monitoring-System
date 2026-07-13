-- ================================================================
-- Migration 41: Split delay_reason on kd2_vehicle_units by VPX
-- category (Hull / Turret / Assembly for K9, Structure / Assembly
-- for K10/K11) instead of one reason per vehicle.
--
-- Safe to run whether or not migration 40 (delay_reason text) has
-- already been applied — if the column exists as text, it's renamed
-- out of the way rather than dropped, and a fresh jsonb column is
-- added. Shape: { "Hull": "text", "Turret": "text", ... }.
-- ================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kd2_vehicle_units'
          AND column_name = 'delay_reason' AND data_type <> 'jsonb'
    ) THEN
        ALTER TABLE public.kd2_vehicle_units RENAME COLUMN delay_reason TO delay_reason_legacy_text;
    END IF;
END $$;

ALTER TABLE public.kd2_vehicle_units
ADD COLUMN IF NOT EXISTS delay_reason jsonb DEFAULT '{}'::jsonb;
