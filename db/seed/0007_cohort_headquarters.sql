-- Seed: corporate headquarters for the pilot cohort.
--
-- ADDRESSES ONLY. Every row here carries a postal address that the company
-- itself publishes, and NO LATITUDE OR LONGITUDE. Coordinates are written by
-- the geocoder (`/api/resolve-locations`) or not at all — a pair of numbers
-- typed by hand has no source to check it against, and on a map it would be
-- indistinguishable from one that does.
--
-- A HEADQUARTERS IS NEVER A PROJECT LOCATION. These rows live in
-- `organization_locations`, whose CHECK constraint admits only
-- 'corporate_headquarters' and 'known_company_facility'. The project table is
-- a different table with a different vocabulary, so a head office cannot be
-- written where a project belongs even by direct SQL.
--
-- Idempotent, like every seed here: re-running applies a correction rather than
-- failing on a duplicate key.
begin;

insert into organization_locations
    (organization_id, location_type, label, address_text, locality, region, country, source_note)
select o.id,
       'corporate_headquarters',
       v.label,
       v.address_text,
       v.locality,
       v.region,
       'United States',
       'Publicly published corporate headquarters address. Account context only; never a project location.'
from (values
    ('PepsiCo, Inc.',      'PepsiCo corporate headquarters',     '700 Anderson Hill Road',      'Purchase',   'New York'),
    ('Tyson Foods, Inc.',  'Tyson Foods corporate headquarters', '2200 West Don Tyson Parkway', 'Springdale', 'Arkansas'),
    ('Mars, Incorporated', 'Mars corporate headquarters',        '6885 Elm Street',             'McLean',     'Virginia')
) as v(canonical_name, label, address_text, locality, region)
join organizations o on o.canonical_name = v.canonical_name
on conflict (organization_id, location_type, label) do update
set address_text = excluded.address_text,
    locality     = excluded.locality,
    region       = excluded.region,
    country      = excluded.country,
    source_note  = excluded.source_note,
    updated_at   = now();

commit;
