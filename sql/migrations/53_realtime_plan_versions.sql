-- 53_realtime_plan_versions.sql
--
-- Plan-version changes (create / rename / archive / restore / delete)
-- propagate to every open session in real time. This adds plan_versions to
-- the realtime publication.
--
-- Safe to re-run.
do $$
begin
    begin
        alter publication supabase_realtime add table public.plan_versions;
    exception
        when duplicate_object then null;
        when undefined_object then null;
    end;
end $$;
