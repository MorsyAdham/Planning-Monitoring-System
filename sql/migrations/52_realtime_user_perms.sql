-- 52_realtime_user_perms.sql
--
-- Live permission changes: when an admin edits a user's role / module
-- access / can_export / is_active in User Management, that user's open
-- session picks it up immediately (the client watches its own
-- planning_app_users row over realtime). This just makes sure the table is
-- in the realtime publication.
--
-- Safe to re-run.
do $$
begin
    begin
        alter publication supabase_realtime add table public.planning_app_users;
    exception
        when duplicate_object then null;
        when undefined_object then null;
    end;
end $$;
