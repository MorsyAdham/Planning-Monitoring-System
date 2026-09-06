-- 45_fix_kd2_plan_live_retired_stations.sql
--
-- Bug: kd2_plan_live inner-joined kd2_process_stations/kd2_process_categories
-- with "and s.is_active = true" / "and c.is_active = true" in the join
-- condition. Retiring (soft-deleting) a station or category — or simply
-- reordering the Manage Processes "Flow" view, which can touch the same
-- rows — silently dropped every already-scheduled kd2_plan row for that
-- station/category out of the view entirely, even though the underlying
-- kd2_plan rows (and their progress) were untouched. Those rows then
-- vanished from the Gantt, VPX, and every other screen that reads
-- kd2_plan_live, contradicting the "Existing KD2 plan history will be
-- kept" promise shown when retiring a station.
--
-- Fix: LEFT JOIN instead, and drop the is_active predicate from the join
-- condition (is_active still correctly gates which stations/categories are
-- offered when creating *new* plan rows elsewhere — this view is read-only
-- historical display). A retired station's name/work center still
-- resolves normally since retiring never changes vehicle_type/station_code;
-- station_code/category_code fall back to raw codes only in the
-- (currently impossible, no hard deletes exist) case a row is gone.
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
