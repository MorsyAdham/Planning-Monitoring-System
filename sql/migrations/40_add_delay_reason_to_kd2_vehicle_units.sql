-- ================================================================
-- Migration 40: Add delay-reason column to kd2_vehicle_units
--
-- Free-text explanation of a vehicle's main delay, editable from the
-- VPX Station Report screen. One current value per vehicle (no
-- history) — overwritten each time it's edited.
-- ================================================================

ALTER TABLE public.kd2_vehicle_units
ADD COLUMN IF NOT EXISTS delay_reason text;
