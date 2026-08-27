-- 0006 — The two live sources for the first cohort.
--
-- SEEDED DISABLED. `enabled = false` is deliberate: enabling a source is an
-- operator decision made at the moment someone is watching, not something a
-- migration does on everyone's behalf. The backfill runbook enables them.
--
-- THE RETRIEVAL STRATEGY IS DATA. `connector_config` holds the candidate feed,
-- sitemap and index URLs for Mars, and the filing-type filter for SEC. The
-- development environment that wrote this connector could not reach either
-- host, so these are starting points to be confirmed on the first live run —
-- and correcting one is an update statement, not a deploy.
--
-- Idempotent, like every seed here: re-running updates the row in place and
-- never resets `enabled`, `health_status` or `last_success_at`, which belong
-- to the operator and to the runs.

insert into sources (
    id, name, source_type, collection_method, base_url, allowed_domains,
    redirect_policy, authentication_mode, schedule, freshness_sla_hours,
    enabled, health_status, license_mode, access_mode, data_sensitivity_class,
    query_scope, extraction_config, retry_policy, operator_intervention,
    connector_id, connector_config, expected_cadence_hours, terms_reviewed_at,
    license_notes
) values (
    'sec-edgar',
    'SEC EDGAR — company filings',
    'regulatory_filing',
    'api',
    'https://data.sec.gov',
    array['sec.gov', 'data.sec.gov', 'www.sec.gov'],
    'allowlist_only',
    'none',
    '0 6 * * *',
    48,
    false,
    'disabled',
    'open',
    'structured_primary',
    'public',
    jsonb_build_object(
        'forms', jsonb_build_array('8-K', '8-K/A', '10-K', '10-K/A', '10-Q', '10-Q/A'),
        'followExhibits', true,
        'note', 'CIKs are resolved at run time from company_tickers.json. No CIK is configured here on purpose.'
    ),
    jsonb_build_object('textExtraction', 'html_to_text', 'exhibitPattern', '^ex-?99'),
    jsonb_build_object('attempts', 4, 'baseDelayMs', 500, 'maxDelayMs', 8000, 'retryOn', jsonb_build_array(408, 425, 429, 500, 502, 503, 504)),
    jsonb_build_object('manualImport', false, 'notes', 'Documented JSON APIs. No browser automation, ever.'),
    'sec-edgar',
    jsonb_build_object('minRequestIntervalMs', 220, 'concurrency', 3),
    24,
    now(),
    'US government work, public domain. Fair-access guidance requires a declared User-Agent naming a monitored contact.'
)
on conflict (id) do update set
    name              = excluded.name,
    source_type       = excluded.source_type,
    collection_method = excluded.collection_method,
    base_url          = excluded.base_url,
    allowed_domains   = excluded.allowed_domains,
    query_scope       = excluded.query_scope,
    extraction_config = excluded.extraction_config,
    retry_policy      = excluded.retry_policy,
    connector_id      = excluded.connector_id,
    license_notes     = excluded.license_notes,
    updated_at        = now();

insert into sources (
    id, name, source_type, collection_method, base_url, allowed_domains,
    redirect_policy, authentication_mode, schedule, freshness_sla_hours,
    enabled, health_status, license_mode, access_mode, data_sensitivity_class,
    query_scope, extraction_config, retry_policy, operator_intervention,
    connector_id, connector_config, expected_cadence_hours, license_notes
) values (
    'mars-newsroom',
    'Mars, Incorporated — official newsroom',
    'company_press',
    'feed',
    'https://www.mars.com',
    array['mars.com', 'www.mars.com'],
    'allowlist_only',
    'none',
    '0 6 * * *',
    72,
    false,
    'disabled',
    'unknown',
    'reference_only',
    'public',
    jsonb_build_object(
        'entityKey', 'radar:mars-incorporated',
        'note', 'Mars is privately held. There is no SEC equivalent and none is manufactured.'
    ),
    jsonb_build_object('preferJsonLd', true, 'fallback', 'open_graph_then_title'),
    jsonb_build_object('attempts', 3, 'baseDelayMs', 1000, 'maxDelayMs', 8000),
    jsonb_build_object(
        'manualImport', true,
        'notes', 'If no compliant automated path exists, the source stays supported and items are imported by an operator. The access control is never bypassed.'
    ),
    'mars-newsroom',
    jsonb_build_object(
        'origin', 'https://www.mars.com',
        'robotsUrl', 'https://www.mars.com/robots.txt',
        'feedCandidates', jsonb_build_array(
            'https://www.mars.com/rss.xml',
            'https://www.mars.com/news-and-stories/rss',
            'https://www.mars.com/feed'
        ),
        'sitemapCandidates', jsonb_build_array('https://www.mars.com/sitemap.xml'),
        'indexCandidates', jsonb_build_array(
            'https://www.mars.com/news-and-stories',
            'https://www.mars.com/news',
            'https://www.mars.com/press-releases'
        ),
        'itemPathPattern', '(news|press|stor|release|announce)',
        'entityKey', 'radar:mars-incorporated',
        'canonicalName', 'Mars, Incorporated',
        'minRequestIntervalMs', 1500,
        'concurrency', 2,
        'confirmedOnFirstLiveRun', false
    ),
    24,
    'Official corporate communications. robots.txt is read and obeyed before any other request.'
)
on conflict (id) do update set
    name              = excluded.name,
    source_type       = excluded.source_type,
    collection_method = excluded.collection_method,
    base_url          = excluded.base_url,
    allowed_domains   = excluded.allowed_domains,
    query_scope       = excluded.query_scope,
    extraction_config = excluded.extraction_config,
    retry_policy      = excluded.retry_policy,
    connector_id      = excluded.connector_id,
    license_notes     = excluded.license_notes,
    updated_at        = now();
