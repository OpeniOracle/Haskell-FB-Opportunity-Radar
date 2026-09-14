-- 0023 — Where a project is, and how sure we are that it is there.
--
-- THREE TABLES, AND THE SPLIT BETWEEN THEM IS THE POINT.
--
--   organization_locations   where a COMPANY is — a head office, a site we hold
--                            for them. Account context. Never a project.
--   opportunity_locations    where a DOCUMENT said a PROJECT is. One row per
--                            place a filing named, tied to the evidence it came
--                            from.
--   geocode_cache            the geocoder's answers, keyed on the query text,
--                            so the same phrase is never billed or asked twice.
--
-- Keeping the first two apart in the SCHEMA rather than in a `kind` column is
-- deliberate. A map pin is the most confident thing an interface can draw: a dot
-- reads as "the project is here" whatever the caption says. The single most
-- likely way to get that wrong is to put a head office in a project column
-- because it was the only coordinate available, and a foreign key to
-- `opportunities` that a headquarters row cannot satisfy is what makes that
-- mistake impossible rather than merely discouraged.
--
-- NOTHING HERE IS SEEDED WITH A COORDINATE. The headquarters rows below carry
-- public postal addresses and no latitude or longitude at all. Coordinates are
-- written by the geocoder or not at all — a hand-typed pair of numbers is a
-- fabrication with a citation-shaped hole where its source should be.
begin;

-- ---------------------------------------------------------------------------
-- 1. Vocabulary, as constraints rather than as convention.
-- ---------------------------------------------------------------------------

create table geocode_cache (
    id                 uuid primary key default gen_random_uuid(),
    -- Lower-cased, whitespace-collapsed query text. The cache key.
    query_normalized   text not null unique,
    query_as_asked     text not null,
    latitude           double precision,
    longitude          double precision,
    normalized_address text,
    precision          text not null,
    provider           text not null,
    -- Null when the provider answered and matched nothing. A recorded miss is
    -- what stops the same dead phrase being asked on every run.
    matched            boolean not null default true,
    resolved_at        timestamptz not null default now(),

    constraint geocode_cache_precision_check
        check (precision in ('exact', 'address', 'locality', 'county', 'region', 'unresolved')),
    constraint geocode_cache_coordinates_together
        check ((latitude is null) = (longitude is null)),
    constraint geocode_cache_latitude_range
        check (latitude is null or (latitude >= -90 and latitude <= 90)),
    constraint geocode_cache_longitude_range
        check (longitude is null or (longitude >= -180 and longitude <= 180)),
    -- A matched result without a coordinate is not a match.
    constraint geocode_cache_match_has_coordinates
        check (matched = false or latitude is not null)
);

comment on table geocode_cache is
    'Geocoder answers keyed on normalized query text, including recorded misses, so no phrase is resolved twice.';

create table organization_locations (
    id                 uuid primary key default gen_random_uuid(),
    organization_id    uuid not null references organizations(id) on delete cascade,
    location_type      text not null,
    label              text not null,
    address_text       text,
    locality           text,
    region             text,
    country            text,
    normalized_address text,
    latitude           double precision,
    longitude          double precision,
    precision          text not null default 'unresolved',
    -- Where this address came from, in words. A location with no provenance is
    -- indistinguishable from one somebody typed.
    source_note        text not null,
    resolved_at        timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    unique (organization_id, location_type, label),

    -- A HEADQUARTERS IS NOT A PROJECT SITE, AND THIS TABLE CANNOT HOLD ONE.
    constraint organization_locations_type_check
        check (location_type in ('corporate_headquarters', 'known_company_facility')),
    constraint organization_locations_precision_check
        check (precision in ('exact', 'address', 'locality', 'county', 'region', 'unresolved')),
    constraint organization_locations_coordinates_together
        check ((latitude is null) = (longitude is null)),
    constraint organization_locations_resolved_has_coordinates
        check (precision = 'unresolved' or latitude is not null),
    constraint organization_locations_source_note_present
        check (length(trim(source_note)) > 0)
);

comment on table organization_locations is
    'Where a COMPANY is. Account context only — a row here is never a project location.';

create table opportunity_locations (
    id                  uuid primary key default gen_random_uuid(),
    opportunity_id      uuid not null references opportunities(id) on delete cascade,
    -- The document that named the place. Null only if the evidence row is later
    -- superseded; the extracted text stays either way.
    evidence_id         uuid references evidence(id) on delete set null,
    location_type       text not null,
    -- WHAT THE DOCUMENT SAID, VERBATIM, BEFORE ANY GEOCODING.
    -- The coordinate can always be checked against this.
    extracted_text      text not null,
    facility_name       text,
    address_text        text,
    locality            text,
    county              text,
    region              text,
    country             text,
    normalized_address  text,
    latitude            double precision,
    longitude           double precision,
    precision           text not null default 'unresolved',
    -- Metres. Non-null whenever the precision is coarser than an address, so a
    -- city-level match is drawn as the area it is rather than as a street corner.
    uncertainty_radius_m integer,
    extractor           text not null,
    resolved_at         timestamptz,
    created_at          timestamptz not null default now(),

    unique (opportunity_id, extracted_text),

    -- A PROJECT LOCATION IS EITHER A SITE A FILING NAMED OR AN AREA IT NAMED.
    -- 'corporate_headquarters' is not a member and cannot be written here.
    constraint opportunity_locations_type_check
        check (location_type in ('confirmed_project_site', 'approximate_project_area')),
    constraint opportunity_locations_precision_check
        check (precision in ('exact', 'address', 'locality', 'county', 'region', 'unresolved')),
    constraint opportunity_locations_coordinates_together
        check ((latitude is null) = (longitude is null)),
    constraint opportunity_locations_resolved_has_coordinates
        check (precision = 'unresolved' or latitude is not null),
    -- A COARSE MATCH MUST CARRY ITS UNCERTAINTY.
    -- Without this a locality-level coordinate is indistinguishable from a
    -- surveyed one, which is the whole failure this table exists to prevent.
    constraint opportunity_locations_coarse_match_has_radius
        check (precision not in ('locality', 'county', 'region') or uncertainty_radius_m is not null),
    -- An exact site claim requires an exact or address-level resolution.
    constraint opportunity_locations_confirmed_site_is_precise
        check (
            location_type <> 'confirmed_project_site'
            or precision in ('exact', 'address', 'unresolved')
        ),
    constraint opportunity_locations_extracted_text_present
        check (length(trim(extracted_text)) > 0)
);

comment on table opportunity_locations is
    'Where a FILING said a project is. One row per place named, with the source text kept beside the coordinate.';

create index opportunity_locations_opportunity_idx on opportunity_locations (opportunity_id);
create index organization_locations_organization_idx on organization_locations (organization_id);

-- ---------------------------------------------------------------------------
-- 2. Who may read this.
--
-- The two location tables are readable by a signed-in reviewer: they are what
-- the map draws. `geocode_cache` is NOT — it is an operational table holding a
-- third party's responses, the browser has no use for it, and the smallest
-- readable surface is the correct one.
--
-- Every grant below names its columns. Migration 0021 added columns to granted
-- tables and granted none of them, which took every surface down with a 42501
-- reported to users as "your access has been withdrawn" (see 0022). Column
-- lists are why that was survivable; they are used here for the same reason.
-- ---------------------------------------------------------------------------

alter table geocode_cache enable row level security;
alter table geocode_cache force row level security;
alter table organization_locations enable row level security;
alter table organization_locations force row level security;
alter table opportunity_locations enable row level security;
alter table opportunity_locations force row level security;

revoke all on geocode_cache from anon, authenticated;
revoke all on organization_locations from anon, authenticated;
revoke all on opportunity_locations from anon, authenticated;

grant select (
    id, organization_id, location_type, label, address_text, locality, region,
    country, normalized_address, latitude, longitude, precision, source_note,
    resolved_at
) on organization_locations to authenticated;

grant select (
    id, opportunity_id, evidence_id, location_type, extracted_text,
    facility_name, address_text, locality, county, region, country,
    normalized_address, latitude, longitude, precision, uncertainty_radius_m,
    extractor, resolved_at
) on opportunity_locations to authenticated;

create policy organization_locations_read_authenticated on public.organization_locations
    for select to authenticated using (true);
create policy opportunity_locations_read_authenticated on public.opportunity_locations
    for select to authenticated using (true);

-- `geocode_cache` gets RLS, no grant and no policy. It is unreachable from the
-- browser by construction, not by omission.

-- ---------------------------------------------------------------------------
-- 3. Headquarters, as public addresses with no coordinates.
--
-- These three are matters of public record — each company's own corporate
-- address, as published. They are seeded as TEXT ONLY: `precision` stays
-- 'unresolved' and latitude and longitude stay null until the geocoder resolves
-- them, because a coordinate typed by hand has no source to check it against.
--
-- `source_note` carries where the address came from. `on conflict do nothing`
-- so re-running this migration against a database that already holds them is a
-- no-op rather than a duplicate-key failure.
-- ---------------------------------------------------------------------------

insert into organization_locations
    (organization_id, location_type, label, address_text, locality, region, country, source_note)
select o.id, 'corporate_headquarters', v.label, v.address_text, v.locality, v.region, 'United States',
       'Publicly published corporate headquarters address. Account context only; never a project location.'
from (values
    ('PepsiCo, Inc.',     'PepsiCo corporate headquarters',     '700 Anderson Hill Road',        'Purchase',   'New York'),
    ('Tyson Foods, Inc.', 'Tyson Foods corporate headquarters', '2200 West Don Tyson Parkway',   'Springdale', 'Arkansas'),
    ('Mars, Incorporated','Mars corporate headquarters',        '6885 Elm Street',               'McLean',     'Virginia')
) as v(canonical_name, label, address_text, locality, region)
join organizations o on o.canonical_name = v.canonical_name
on conflict (organization_id, location_type, label) do nothing;

commit;
