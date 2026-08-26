-- Seed: the pilot sources.
--
-- DISABLED. `enabled = false` on every row, because the Production Foundation
-- PR implements no connector. A source marked enabled with nothing behind it
-- would report healthy while collecting nothing, which is the exact confusion
-- C23 exists to prevent. The First Live Data PR enables them as it implements
-- each one.
--
-- Only endpoints VERIFIED against a government-controlled host are seeded here.
-- The corporate newsroom and investor-relations endpoints in the coverage matrix
-- are recorded as Unverified — the host and path pattern appeared as live result
-- URLs during research, but the pages were never fetched — and the matrix
-- requires a connector dry run before enablement. Seeding them now would assert
-- a verification that has not happened.
--
-- ACCESS MODE is the approved pilot implementation of D19 (ADR 0014):
--   U.S. government material   archived_full_text
--   corporate material         reference_only

insert into sources (
    id, name, source_type, collection_method, base_url, allowed_domains,
    redirect_policy, authentication_mode, schedule, freshness_sla_hours,
    enabled, health_status,
    license_mode, access_mode, data_sensitivity_class,
    expected_cadence_hours, license_notes
) values
    ('sec-edgar',
     'SEC EDGAR full-text and submissions',
     'regulatory_filing', 'rest_api',
     'https://data.sec.gov/',
     array['sec.gov', 'data.sec.gov', 'www.sec.gov'],
     'allowlist_only', 'none', 'daily', 24,
     false, 'disabled',
     'open', 'archived_full_text', 'public',
     24,
     'U.S. government work. SEC requires a declared User-Agent carrying a monitored contact address and rate-limits to 10 requests per second.'),

    ('fsis-mpi',
     'FSIS Meat, Poultry and Egg Product Inspection Directory',
     'regulatory_registry', 'bulk_download',
     'https://www.fsis.usda.gov/',
     array['fsis.usda.gov', 'www.fsis.usda.gov'],
     'allowlist_only', 'none', 'daily', 24,
     false, 'disabled',
     'open', 'archived_full_text', 'public',
     24,
     'U.S. government work. The authoritative dataset location is verified at connector implementation time rather than assumed here.')

on conflict (id) do update set
    name                    = excluded.name,
    base_url                = excluded.base_url,
    allowed_domains         = excluded.allowed_domains,
    license_mode            = excluded.license_mode,
    access_mode             = excluded.access_mode,
    data_sensitivity_class  = excluded.data_sensitivity_class,
    expected_cadence_hours  = excluded.expected_cadence_hours,
    license_notes           = excluded.license_notes,
    updated_at              = now();
