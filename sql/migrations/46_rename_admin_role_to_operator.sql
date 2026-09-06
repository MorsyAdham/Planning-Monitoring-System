-- 46_rename_admin_role_to_operator.sql
--
-- The "admin" role is really a production data-entry role, not a system
-- administrator — it can edit progress/issues but not the plan schedule or
-- any system settings. Rename it to "operator" everywhere.
--
-- Role hierarchy after this migration (low -> high access):
--   viewer      — read only
--   operator    — edit production data (was "admin")
--   planner     — everything operator can, plus plan/schedule edits
--   master_admin — full access + system management (auth, users, exports)
--
-- Apply in the Supabase SQL editor. Safe to re-run.
begin;

-- Drop any CHECK constraint on planning_app_users that references `role`
-- (name is unknown — it predates the tracked migrations), so the value
-- update below can't be blocked by a stale allow-list.
do $$
declare c record;
begin
    for c in
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public'
          and rel.relname = 'planning_app_users'
          and con.contype = 'c'
          and pg_get_constraintdef(con.oid) ilike '%role%'
    loop
        execute format('alter table public.planning_app_users drop constraint %I', c.conname);
    end loop;
end $$;

update public.planning_app_users
set role = 'operator'
where role = 'admin';

alter table public.planning_app_users
    add constraint planning_app_users_role_check
    check (role in ('viewer', 'operator', 'planner', 'master_admin'));

commit;

-- Historical planning_audit_log rows keep their original user_role text
-- ('admin') on purpose — they record what the role was named at the time.
