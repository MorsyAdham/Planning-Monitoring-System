-- 51_kd2_plan_parallel_flag.sql
--
-- Per-version route ordering: the active plan version's kd2_plan rows are now
-- the source of truth for route order, and the Gantt reorder surface writes
-- route_sequence + parallel_with_previous straight onto them (per version,
-- leaving every other version and the global catalog alone).
--
-- kd2_plan already carries route_sequence; this adds the parallel flag and
-- seeds it from whatever the catalog currently says, matched by station_code.
--
-- Safe to re-run.
begin;

alter table public.kd2_plan
    add column if not exists parallel_with_previous boolean not null default false;

update public.kd2_plan p
set parallel_with_previous = coalesce(s.parallel_with_previous, false)
from public.kd2_process_stations s
where s.vehicle_type = p.vehicle_type
  and s.station_code = p.station_code
  and p.parallel_with_previous is distinct from coalesce(s.parallel_with_previous, false);

commit;
