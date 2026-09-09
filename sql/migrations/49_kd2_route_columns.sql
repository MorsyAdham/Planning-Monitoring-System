-- 49_kd2_route_columns.sql
--
-- Two columns on kd2_process_stations for the visual route editor:
--
--   parallel_with_previous  — true for the 2nd..Nth station of a slot that
--     runs in parallel (they share route_sequence). Derived and rewritten by
--     the app's normalizeRoute(); the DB column is just so generation and any
--     other reader can see the flag without recomputing it. Backfilled here
--     from the current equal-route_sequence runs, per vehicle + component
--     track (Hull / Turret / Structure / downstream) so a Hull step N and a
--     Turret step N are NOT treated as parallel with each other.
--
--   gap_days_before  — working days to wait before this slot starts, set on
--     the slot's first station. Replaces the "space" rows of
--     kd2_template_layout_items (which a later migration drops). Backfilled
--     from those space rows.
--
-- Safe to re-run.
begin;

alter table public.kd2_process_stations
    add column if not exists parallel_with_previous boolean not null default false;
alter table public.kd2_process_stations
    add column if not exists gap_days_before integer not null default 0;

-- ── backfill parallel_with_previous ─────────────────────────────
-- A station is parallel-with-previous when another station in the SAME
-- vehicle + track has the same route_sequence and a lexicographically
-- smaller station_code (so exactly one member of each parallel slot stays
-- false — the "primary").
with tracked as (
    select
        s.vehicle_type,
        s.station_code,
        s.route_sequence,
        case
            when s.vehicle_type = 'K9' and s.component_group in ('Hull', 'Turret') then s.component_group
            when s.category_code in ('assembly', 'processing', 'final_test') then 'downstream'
            when s.vehicle_type = 'K9' then 'downstream'
            else 'structure'
        end as track
    from public.kd2_process_stations s
    where s.is_active = true
)
update public.kd2_process_stations t
set parallel_with_previous = exists (
    select 1
    from tracked a
    join tracked b
        on b.vehicle_type = a.vehicle_type
       and b.track = a.track
       and b.route_sequence = a.route_sequence
       and b.station_code < a.station_code
    where a.vehicle_type = t.vehicle_type
      and a.station_code = t.station_code
)
where t.is_active = true;

-- ── backfill gap_days_before from kd2_template_layout_items ──────
-- A "space" row's gap applies to the next process row in sort order.
do $$
begin
    if to_regclass('public.kd2_template_layout_items') is not null then
        with ordered as (
            select
                vehicle_type, kind, station_code, gap_days, sort_order,
                lead(station_code) over (partition by vehicle_type order by sort_order)  as next_code,
                lead(kind)         over (partition by vehicle_type order by sort_order)  as next_kind
            from public.kd2_template_layout_items
        )
        update public.kd2_process_stations s
        set gap_days_before = coalesce(o.gap_days, 0)
        from ordered o
        where o.kind = 'space'
          and o.next_kind = 'process'
          and o.next_code = s.station_code
          and s.vehicle_type = o.vehicle_type
          and coalesce(o.gap_days, 0) > 0;
    end if;
end $$;

commit;
