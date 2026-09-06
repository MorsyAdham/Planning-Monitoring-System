-- ================================================================
-- Migration 43: Plan revisions (versioned plans + switcher)
--
-- Introduces plan_versions: a named, per-module "version" of a plan.
-- The three modules keep their own plan table and get their own
-- plan_version_id column — they are NOT shared:
--   kd1     -> assembly_plan
--   kd2     -> kd2_plan
--   f100kd2 -> f100_plans (its own table — battalion_code, vehicle_type,
--              serial_number, part_id, process_id, planned/actual dates,
--              status, notes, comments all on one row; no separate
--              progress table)
--
-- assembly_progress / kd2_progress need no new column — they key off
-- plan_id, and a cloned revision gets fresh plan ids, so each
-- version's progress is naturally independent. f100_plans carries its
-- own actual_start_date/actual_end_date/status/notes/comments inline,
-- so cloning it resets those fields explicitly (see app-side clone
-- logic in scripts/core/plan-versions.js).
--
-- production_issues is NOT version-scoped — issues are shared across every
-- revision of a module's plan, not per-version (an earlier draft of this
-- migration added plan_version_id here; the cleanup at the bottom drops it
-- again in case that draft already ran somewhere).
-- ================================================================

begin;

create table if not exists public.plan_versions (
    id bigint generated always as identity primary key,
    module_id text not null check (module_id in ('kd1', 'kd2', 'f100kd2')),
    name text not null,
    status text not null default 'active' check (status in ('active', 'archived')),
    is_baseline boolean not null default false,
    created_by text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_plan_versions_updated_at on public.plan_versions;
create trigger trg_plan_versions_updated_at
before update on public.plan_versions
for each row execute function public.set_updated_at();

-- One baseline version per module, created only if that module has no
-- baseline yet (safe to re-run).
insert into public.plan_versions (module_id, name, status, is_baseline)
select m, 'Baseline Plan', 'active', true
from unnest(array['kd1', 'kd2', 'f100kd2']) as m
where not exists (
    select 1 from public.plan_versions v where v.module_id = m and v.is_baseline
);

-- ---------------------------------------------------------------
-- assembly_plan (KD1)
-- ---------------------------------------------------------------
alter table public.assembly_plan add column if not exists plan_version_id bigint
    references public.plan_versions(id);

update public.assembly_plan
set plan_version_id = (select id from public.plan_versions where module_id = 'kd1' and is_baseline)
where plan_version_id is null;

alter table public.assembly_plan alter column plan_version_id set not null;
create index if not exists idx_assembly_plan_version on public.assembly_plan(plan_version_id);

-- ---------------------------------------------------------------
-- kd2_plan (KD2)
-- ---------------------------------------------------------------
alter table public.kd2_plan add column if not exists plan_version_id bigint
    references public.plan_versions(id);

update public.kd2_plan
set plan_version_id = (select id from public.plan_versions where module_id = 'kd2' and is_baseline)
where plan_version_id is null;

alter table public.kd2_plan alter column plan_version_id set not null;
create index if not exists idx_kd2_plan_version on public.kd2_plan(plan_version_id);

-- The original unique constraint (battalion_id, vehicle_type, unit_serial,
-- station_code) predates plan_version_id and would wrongly collide across
-- versions (kd2.js's import upsert conflicts on exactly these columns).
-- Widen it to include plan_version_id, whatever Postgres named it.
do $$
declare
    con_name text;
begin
    select con.conname into con_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'kd2_plan'
      and con.contype = 'u'
      and con.conkey = (
          select array_agg(attnum order by attnum)
          from pg_attribute
          where attrelid = rel.oid
            and attname in ('battalion_id', 'vehicle_type', 'unit_serial', 'station_code')
      );
    if con_name is not null then
        execute format('alter table public.kd2_plan drop constraint %I', con_name);
    end if;
end $$;

alter table public.kd2_plan
    add constraint kd2_plan_version_unique unique (plan_version_id, battalion_id, vehicle_type, unit_serial, station_code);

-- ---------------------------------------------------------------
-- f100_plans (F100-KD2 — its own table, not kd2_plan)
-- ---------------------------------------------------------------
alter table public.f100_plans add column if not exists plan_version_id bigint
    references public.plan_versions(id);

update public.f100_plans
set plan_version_id = (select id from public.plan_versions where module_id = 'f100kd2' and is_baseline)
where plan_version_id is null;

alter table public.f100_plans alter column plan_version_id set not null;
create index if not exists idx_f100_plans_version on public.f100_plans(plan_version_id);

-- ---------------------------------------------------------------
-- production_issues stays shared across every plan version — no new
-- column. Cleanup in case an earlier run of this migration added one.
-- ---------------------------------------------------------------
drop index if exists public.idx_production_issues_plan_version;
alter table public.production_issues drop column if exists plan_version_id;

-- ---------------------------------------------------------------
-- kd2_plan_live view — expose plan_version_id (everything else unchanged)
-- ---------------------------------------------------------------
drop view if exists public.kd2_plan_live;
create or replace view public.kd2_plan_live as
select
    p.id,
    p.plan_version_id,
    p.vehicle_type as vehicle,
    coalesce(
        p.unit_label,
        vu.unit_label,
        case
            when p.unit_serial is not null then concat(b.battalion_code, ' / ', p.vehicle_type, '-', lpad(p.unit_serial::text, 2, '0'))
            else b.battalion_code
        end
    ) as vehicle_no,
    c.category_name as category,
    c.category_code,
    s.station_name as process_station,
    s.station_code,
    s.work_center,
    p.schedule_week as week,
    p.planned_start_date as start_date,
    p.planned_end_date as end_date,
    p.remark,
    c.category_sequence as step_sequence,
    s.station_sequence_in_category,
    p.route_sequence,
    b.battalion_code,
    g.id as progress_id,
    g.completed,
    g.completion_date,
    g.actual_start_date,
    g.notes,
    g.updated_at as progress_updated_at
from public.kd2_plan p
join public.kd2_battalions b on b.id = p.battalion_id
join public.kd2_process_categories c
    on c.vehicle_type = p.vehicle_type
   and c.category_code = p.category_code
   and c.is_active = true
join public.kd2_process_stations s
    on s.vehicle_type = p.vehicle_type
   and s.station_code = p.station_code
   and s.is_active = true
left join public.kd2_vehicle_units vu
    on vu.battalion_id = p.battalion_id
   and vu.vehicle_type = p.vehicle_type
   and vu.unit_serial = p.unit_serial
left join public.kd2_progress g on g.plan_id = p.id;

commit;
