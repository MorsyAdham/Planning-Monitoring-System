-- ================================================================
-- Migration 39: Indexes for production_issues
--
-- loadIssues()/_populateIssueReporterFilter()/loadIssuesOverview() all
-- filter by module and order by created_at, with optional status/category/
-- reporter_email filters — no indexes exist on this table in-repo, so
-- these are likely sequential-scanning as the table grows. Run manually
-- in the Supabase SQL editor (no service-role key available to apply
-- this automatically).
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_production_issues_module_created_at
    ON public.production_issues (module, created_at);

CREATE INDEX IF NOT EXISTS idx_production_issues_module_status
    ON public.production_issues (module, status);

CREATE INDEX IF NOT EXISTS idx_production_issues_reporter_email
    ON public.production_issues (reporter_email);
