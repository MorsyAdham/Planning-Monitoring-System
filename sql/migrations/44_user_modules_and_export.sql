-- ================================================================
-- Migration 44: Per-user module access + fold Export Permissions into
-- planning_app_users
--
-- - modules: which of the three modules (kd1/kd2/f100kd2) a user can
--   switch into. Defaults to all three so nobody existing loses access.
--   master_admin always has every module regardless of this column
--   (enforced client-side) — it can't be used to lock out the top admin.
-- - can_export: replaces the standalone ppms_export_permissions table.
--   Master Admin can always export regardless of this flag (same rule
--   the old table's caller-side check already applied).
-- ================================================================

begin;

alter table public.planning_app_users
    add column if not exists modules text[] not null default array['kd1', 'kd2', 'f100kd2'];

alter table public.planning_app_users
    drop constraint if exists planning_app_users_modules_check;
alter table public.planning_app_users
    add constraint planning_app_users_modules_check
    check (modules <@ array['kd1', 'kd2', 'f100kd2']::text[]);

alter table public.planning_app_users
    add column if not exists can_export boolean not null default false;

-- Backfill can_export from the table it's replacing, then retire it.
update public.planning_app_users u
set can_export = true
where exists (
    select 1 from public.ppms_export_permissions p
    where lower(p.email) = lower(u.email)
);

drop table if exists public.ppms_export_permissions;

commit;
