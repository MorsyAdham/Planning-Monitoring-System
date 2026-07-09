-- ================================================================
-- Migration 38: Add Person In Charge (PIC) column to production_issues
--
-- Optional free-text field identifying who is responsible for
-- resolving/following up on an issue. No constraint — may be blank.
-- ================================================================

ALTER TABLE public.production_issues
ADD COLUMN IF NOT EXISTS person_in_charge text;
