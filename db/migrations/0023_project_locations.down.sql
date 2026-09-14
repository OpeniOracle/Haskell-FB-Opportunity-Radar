-- Reverses 0023. The seeded headquarters rows go with their table.
begin;

drop policy if exists opportunity_locations_read_authenticated on public.opportunity_locations;
drop policy if exists organization_locations_read_authenticated on public.organization_locations;

drop table if exists opportunity_locations;
drop table if exists organization_locations;
drop table if exists geocode_cache;

commit;
