-- 48_kd2_live_route_order.sql
--
-- kd2_plan rows freeze route_sequence / category_sequence /
-- station_sequence_in_category at generation time. Reordering the process
-- route in the UI afterwards did not reach the Gantt / VPX / Analytics / the
-- cascade-recalc, which read the frozen copy. The app now resolves ordering
-- from the live kd2_process_stations config by station_code; this migration
-- makes the kd2_plan_live view expose the live route_sequence too (with the
-- frozen value kept alongside as route_sequence_frozen), so any consumer that
-- still reads the view column gets the current order and retired stations
-- fall back cleanly.
--
-- Also surfaces s.component_group (Hull / Turret / Structure / downstream) so
-- readers can group by line without the client runtime.
--
-- Everything else is carried forward verbatim from migration 45 (LEFT JOINs,
-- retired-station coalesces). Safe to re-run.
begin;

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
    coalesce(c.category_name, p.category_code) as category,
    p.category_code,
    coalesce(s.station_name, p.station_code) as process_station,
    p.station_code,
    s.work_center,
    s.component_group,
    p.schedule_week as week,
    p.planned_start_date as start_date,
    p.planned_end_date as end_date,
    p.remark,
    c.category_sequence as step_sequence,
    s.station_sequence_in_category,
    coalesce(s.route_sequence, p.route_sequence) as route_sequence,
    p.route_sequence as route_sequence_frozen,
    b.battalion_code,
    g.id as progress_id,
    g.completed,
    g.completion_date,
    g.actual_start_date,
    g.notes,
    g.updated_at as progress_updated_at
from public.kd2_plan p
join public.kd2_battalions b on b.id = p.battalion_id
left join public.kd2_process_categories c
    on c.vehicle_type = p.vehicle_type
   and c.category_code = p.category_code
left join public.kd2_process_stations s
    on s.vehicle_type = p.vehicle_type
   and s.station_code = p.station_code
left join public.kd2_vehicle_units vu
    on vu.battalion_id = p.battalion_id
   and vu.vehicle_type = p.vehicle_type
   and vu.unit_serial = p.unit_serial
left join public.kd2_progress g on g.plan_id = p.id;

commit;
