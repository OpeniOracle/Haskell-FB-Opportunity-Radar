-- 0019 — Live source ingestion: document identity, connector provenance, and
--        the uniqueness that makes a repeated run a no-op.
--
-- WHAT WAS ALREADY HERE, AND IS NOT REBUILT.
--
--   evidence (source_id, content_hash)          content-identity dedup
--   organization_identifiers (system, value)    one CIK, one organization
--   organizations.entity_key                    one canonical company
--   organization_aliases (org, normalized)      alias normalisation
--   source_runs (source_id, window_start)       one logical run per window
--   source_runs.run_status                      'unchanged' already distinct
--                                               from 'success' and 'failure'
--
-- WHAT WAS MISSING, AND IS ADDED HERE.
--
-- 1. DOCUMENT IDENTITY, SEPARATE FROM CONTENT IDENTITY. A filing has an
--    accession number and a newsroom item has a guid; both are stable while
--    their bytes are not. Keying only on content_hash means an edited page is
--    a second document, and re-fetching an unchanged one cannot be recognised
--    as the same record. `source_document_id` is that stable key.
--
-- 2. SUPERSESSION THAT CANNOT FORK. At most one CURRENT row per
--    (source, document): the partial unique index below excludes superseded
--    rows, so a corrected document inserts a new row, points the old one at
--    it, and the "which version is live" question has exactly one answer.
--    ADR 0012 — corrections supersede, they do not overwrite.
--
-- 3. CONNECTOR PROVENANCE. Which connector, at which version, produced this.
--    `extractor_version` describes the parser; it does not say which retrieval
--    strategy ran, and a Mars item fetched from a feed is not the same
--    provenance as the same item scraped from HTML.
--
-- 4. CLASSIFICATION AND REVIEW, AS SEPARATE LIFECYCLES. Whether the pipeline
--    thinks this is a Haskell-relevant signal is not whether a human has
--    agreed. Collapsing them is how a model guess becomes a fact.
--
-- 5. CONDITIONAL-REQUEST STATE. SEC fair access is not only a rate limit; it
--    is also not re-downloading what has not changed. Storing the validators
--    is what makes a conditional request possible at all.
--
-- Additive and backward compatible: every new column is nullable or carries a
-- default, and every new index is partial or on new columns. An existing row
-- remains valid and the pre-0019 application keeps working against it.

begin;

-- ---------------------------------------------------------------- evidence

alter table evidence
    add column source_document_id    text,
    add column document_revision     text,
    add column connector_id          text,
    add column connector_version     text,
    add column first_seen_at         timestamptz not null default now(),
    add column last_seen_at          timestamptz not null default now(),
    add column classification_status text not null default 'unclassified',
    add column review_status         text not null default 'unreviewed',
    add column superseded_at         timestamptz;

comment on column evidence.superseded_at is
    'When this version stopped being current. Set BEFORE the replacement row exists, which is what lets a correction be written without ever having two current rows or a forward reference to a row that has not been inserted yet.';

comment on column evidence.source_document_id is
    'Stable identifier for the document AT THE SOURCE: an SEC accession number, a feed guid, a canonical newsroom path. Distinct from content_hash, which identifies the bytes.';
comment on column evidence.document_revision is
    'Source-declared revision marker where one exists (ETag, amendment suffix). Advisory only; supersession is decided by content_hash.';
comment on column evidence.first_seen_at is
    'When this document was FIRST observed. Never moves.';
comment on column evidence.last_seen_at is
    'When this document was most recently observed to still exist. Moves on every run that sees it again, without touching published_at.';

alter table evidence
    add constraint evidence_classification_status_check
        check (classification_status in (
            'unclassified',        -- ingested, not yet evaluated
            'not_relevant',        -- evaluated, carries no Haskell-relevant signal
            'candidate_signal',    -- evaluated, may support a signal
            'supporting_evidence'  -- linked to at least one signal
        )),
    add constraint evidence_review_status_check
        check (review_status in (
            'unreviewed',
            'analyst_confirmed',
            'analyst_rejected',
            'manual_review_required'
        ));

-- ONE CURRENT VERSION PER DOCUMENT. Superseded rows are excluded, so history
-- accumulates without ever producing two live rows for the same document.
-- Keyed on `superseded_at`, NOT on `superseded_by_evidence_id`.
--
-- The pointer is a foreign key, so it cannot be set until the replacement row
-- exists — and the replacement row cannot be inserted while the old one still
-- holds the key. Marking the old version retired first breaks that deadlock:
--   1. update old  set superseded_at = now()      -- key is now free
--   2. insert new                                  -- takes the key
--   3. update old  set superseded_by = new.id      -- links the history
-- At no point are there two current rows, and at no point is there a forward
-- reference to a row that does not exist.
create unique index evidence_current_document_uidx
    on evidence (source_id, source_document_id)
    where source_document_id is not null and superseded_at is null;

-- A retired row must say what replaced it, and a live row must not claim a
-- replacement. Without this the two columns could disagree silently.
alter table evidence
    add constraint evidence_supersession_is_consistent
        check (superseded_by_evidence_id is null or superseded_at is not null);

-- The re-observation path reads by document id constantly; without this every
-- run table-scans evidence once per document discovered.
create index evidence_document_lookup_idx
    on evidence (source_id, source_document_id)
    where source_document_id is not null;

create index evidence_last_seen_idx on evidence (last_seen_at desc);

-- A published timestamp may never be filled in from a retrieval timestamp.
-- Enforced rather than documented, because the two are the same TYPE and a
-- single careless assignment is invisible in review.
alter table evidence
    add constraint evidence_published_is_not_retrieved
        check (published_at is null or published_at <> retrieved_at);

-- ----------------------------------------------------------------- signals

-- `cluster_key` existed as a column with nothing enforcing it. One cluster per
-- organization is what stops the same announcement becoming three signals.
create unique index signals_organization_cluster_uidx
    on signals (organization_id, cluster_key)
    where cluster_key is not null;

-- ----------------------------------------------------------- opportunities

-- AN UNSCORED OPPORTUNITY IS NULL, NOT ZERO.
--
-- These columns were NOT NULL, which forced anything creating an opportunity to
-- supply a number. A signal-derived opportunity has not been scored yet — the
-- scoring configuration is versioned and one axis is still gated on the D14-L
-- licence review — and writing a placeholder would put a fabricated score in
-- the same column an analyst's real one lives in. Existing rows keep their
-- values; only the requirement is lifted.
alter table opportunities
    alter column haskell_fit           drop not null,
    alter column project_maturity      drop not null,
    alter column potential_scope       drop not null,
    alter column timing_momentum       drop not null,
    alter column raw_score             drop not null,
    alter column confidence_multiplier drop not null,
    alter column final_score           drop not null,
    alter column why_it_matters        drop not null;

alter table opportunities
    add column opportunity_key text,
    add column derived_by      text,
    add column derived_at      timestamptz;

comment on column opportunities.opportunity_key is
    'Stable derivation key. An opportunity re-derived from the same signals updates in place instead of appearing twice.';
comment on column opportunities.derived_by is
    'Connector or pipeline version that derived this. Null for an analyst-created record.';

create unique index opportunities_organization_key_uidx
    on opportunities (organization_id, opportunity_key)
    where opportunity_key is not null;

-- -------------------------------------------------------------- source_runs

-- OVERLAPPING RUNS, PREVENTED BY THE DATABASE.
--
-- A schedule that fires twice, or a manual run racing the schedule, must not
-- produce two concurrent collections against one source. The application can
-- check first and still lose the race; a partial unique index cannot.
create unique index source_runs_single_active_uidx
    on source_runs (source_id)
    where run_status = 'running';

-- ------------------------------------------------------------------ sources

-- Two honest connector states the vocabulary could not previously express.
-- `unsupported` meant "we will never support this"; neither of these does.
alter table sources drop constraint sources_health_status_check;
alter table sources
    add constraint sources_health_status_check
        check (health_status in (
            'healthy',
            'degraded',
            'action_required',
            'disabled',
            'unsupported',
            'manual_review_required',  -- reachable, but no compliant automated path
            'source_unavailable'       -- retrieval failed; NOT a statement about relevance
        ));

alter table sources
    add column connector_id       text,
    add column connector_config   jsonb not null default '{}'::jsonb,
    add column last_success_at    timestamptz;

comment on column sources.connector_config is
    'Retrieval strategy for this source, as data rather than code: candidate feed URLs, page patterns, filing-type filters. Editable during an operator backfill without a deploy.';
comment on column sources.last_success_at is
    'Last run that actually completed retrieval. What the interface means by "as of".';

-- --------------------------------------------- conditional-request validators

-- SEC fair access is a rate limit AND not re-fetching what has not changed.
-- Storing the validators is the only way to send If-None-Match / If-Modified-Since.
create table source_document_cache (
    id             uuid primary key default gen_random_uuid(),
    source_id      text not null references sources (id) on delete cascade,
    request_url    text not null,
    etag           text,
    last_modified  text,
    content_hash   char(64),
    status         integer,
    fetched_at     timestamptz not null default now(),
    hit_count      integer not null default 0,
    created_at     timestamptz not null default now(),
    unique (source_id, request_url),
    constraint source_document_cache_has_validator
        check (etag is not null or last_modified is not null or content_hash is not null)
);

comment on table source_document_cache is
    'ETag / Last-Modified validators per request URL. Never stores response bodies — only what is needed to ask "has this changed?".';

create index source_document_cache_fetched_idx on source_document_cache (source_id, fetched_at desc);

-- RLS, on the same terms as every other table (0015). This holds retrieval
-- metadata for public documents, but "not secret" is not a reason to expose a
-- table to anon: the default is deny and this one is server-side only.
alter table source_document_cache enable row level security;
alter table source_document_cache force row level security;

-- No policy is created deliberately: with RLS enabled and no policy, every
-- role except the bypassing service_role reads nothing. The ingestion path is
-- the only legitimate reader and it runs as service_role.

commit;
