-- 50_realtime_publication.sql
--
-- Make sure every table the KD2 workspace reacts to is in the
-- supabase_realtime publication, so a change one user makes streams to
-- every other open session (and back to the editor, where the app now
-- also refreshes its sibling views locally).
--
-- kd2_progress was the missing one: actual start / completion date and
-- X-ray cycles all live there, and edits to it never reached other users
-- until a manual page refresh.
--
-- Guarded per-table so it is safe to re-run.
do $$
declare
    t text;
begin
    foreach t in array array[
        'kd2_plan',
        'kd2_progress',
        'kd2_process_stations',
        'kd2_process_categories',
        'kd2_process_routes',
        'f100_plans'
    ]
    loop
        begin
            execute format('alter publication supabase_realtime add table public.%I', t);
        exception
            when duplicate_object then null;   -- already published
            when undefined_object then null;   -- publication missing (managed elsewhere)
        end;
    end loop;
end $$;
