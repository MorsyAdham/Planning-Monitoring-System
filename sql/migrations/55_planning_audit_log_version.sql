-- 55_planning_audit_log_version.sql
--
-- Every audited action now happens inside the context of a plan version
-- (kd1/kd2/f100kd2 each have their own active version), but neither the
-- audit log nor the notifications/live-activity feeds fed by it recorded
-- which version was actually being edited — a real gap once multiple
-- revisions of a plan exist side by side (see plan_versions, migration 43).
--
-- Adds plan_version_id (FK, nullable — plenty of audited actions, like user
-- management, aren't version-scoped at all) plus a denormalized
-- plan_version_name snapshot. The name is stored alongside the id (not just
-- looked up via the FK) so historical audit rows keep showing the version
-- name that was true at the time of the action even if that version is
-- later renamed or archived.
--
-- Safe to re-run.
begin;

alter table public.planning_audit_log
    add column if not exists plan_version_id bigint references public.plan_versions(id);

alter table public.planning_audit_log
    add column if not exists plan_version_name text;

create index if not exists idx_planning_audit_log_version
    on public.planning_audit_log(plan_version_id);

commit;
