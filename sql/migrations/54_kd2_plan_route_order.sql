-- 54_kd2_plan_route_order.sql
--
-- Root fix for the K10/K11 "no plan data" reorder dead-end.
--
-- Route order and schedule existence were conflated: a plan version's route
-- position for a station lived on its kd2_plan rows (route_sequence /
-- parallel_with_previous), which only exist for a station once it has been
-- actually scheduled (battalion/unit/dates) in that version. A station with
-- no schedule yet in the active version (common for a partial/revision
-- version — confirmed live: K10 in "RE: KD2 Battalion 1" only had ~5 of its
-- ~34 stations scheduled) had no row to write a new position onto, so the
-- reorder arrows either silently no-op'd ("Already in that position") or,
-- in an earlier attempted fix, fabricated real kd2_plan schedule rows just
-- to hold a position — which incorrectly made those stations look scheduled
-- (phantom tasks on the progress bar).
--
-- This table decouples the two: a per-version route-order override that
-- exists independently of whether the station has any kd2_plan rows yet.
-- kd2.js's getStationLaneOrder / normalizeRoute already read route order
-- through versionRouteFor()/state.versionRoute uniformly regardless of
-- source, so loading this table's rows into that same map (taking priority
-- over the kd2_plan-derived snapshot) makes every station reorderable
-- without ever touching kd2_plan — no schedule rows created, no progress-bar
-- side effects, and the change stays scoped to just the active version.
--
-- Safe to re-run.
begin;

create table if not exists public.kd2_plan_route_order (
    id bigint generated always as identity primary key,
    plan_version_id bigint not null references public.plan_versions(id) on delete cascade,
    vehicle_type text not null,
    station_code text not null,
    route_sequence integer not null,
    parallel_with_previous boolean not null default false,
    category_code text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (plan_version_id, vehicle_type, station_code)
);

create index if not exists idx_kd2_plan_route_order_version
    on public.kd2_plan_route_order(plan_version_id, vehicle_type);

drop trigger if exists trg_kd2_plan_route_order_updated_at on public.kd2_plan_route_order;
create trigger trg_kd2_plan_route_order_updated_at
before update on public.kd2_plan_route_order
for each row execute function public.set_updated_at();

commit;
