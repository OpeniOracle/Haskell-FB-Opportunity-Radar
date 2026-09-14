-- Seed: the default Openi Spyglass destination.
--
-- A DEFAULT, NOT A CONSTANT. The point of holding this in a table is that an
-- application administrator repoints it from the interface without a
-- deployment; seeding it only means the surface works on first load.
--
-- `on conflict do nothing`, deliberately — unlike the headquarters seed, which
-- updates. If an administrator has already moved the dashboard, re-running the
-- seed must not drag it back to this address.
--
-- NO WIDGET IS SEEDED. An embed snippet has to be generated from the dashboard
-- by a person who chose the date range it freezes, and Zignal embeds never
-- refresh — so a widget invented here would show figures nobody reviewed,
-- frozen at a moment nobody chose, under a timestamp that would nonetheless
-- look authoritative.
begin;

insert into spyglass_settings (id, dashboard_url, dashboard_label, updated_by)
values ('default', 'https://zign.al/urgnr9l3', 'Openi Spyglass', 'seed 0008')
on conflict (id) do nothing;

commit;
