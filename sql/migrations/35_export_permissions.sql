-- ================================================================
-- Migration 35: Export permissions table
--
-- Only users listed here (or master_admin) can export reports.
-- Master admin manages this list via the UI.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.ppms_export_permissions (
    id         serial        PRIMARY KEY,
    email      text          NOT NULL UNIQUE,
    note       text,
    granted_by text,
    created_at timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.ppms_export_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_authenticated"
    ON public.ppms_export_permissions
    FOR ALL
    USING (true);
