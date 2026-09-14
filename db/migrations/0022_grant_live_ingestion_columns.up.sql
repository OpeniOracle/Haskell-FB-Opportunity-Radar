-- 0022 — Grant the columns migration 0021 added.
--
-- A PRODUCTION AUTHORIZATION FAILURE THAT WAS NOT AN AUTHORIZATION FAILURE.
--
-- Every surface reported "Your access to the Radar has been withdrawn. Contact
-- your administrator." to a user who was signed in, verified, and present in
-- `auth_invite_allowlist`. Nothing was wrong with the account.
--
-- Migration 0015 grants SELECT on `evidence` and `sources` COLUMN BY COLUMN,
-- deliberately: `body_text`, `archive_uri`, `raw_storage_uri`,
-- `extracted_text_uri` and `connector_config` are withheld from the browser,
-- and a column list is the only way to say that.
--
-- A column-level grant does not extend to columns created afterwards. Migration
-- 0021 added nine columns to `evidence`, three to `opportunities` and three to
-- `sources`, and granted none of them. The client reads several:
--
--   sources.last_success_at        read by `freshness()`, which runs on EVERY
--                                  surface -- which is why every page failed
--   evidence.classification_status  the evidence detail view
--   evidence.review_status          "
--   evidence.connector_id           "
--   evidence.connector_version      "
--   evidence.source_document_id     "
--   evidence.first_seen_at          "
--   evidence.last_seen_at           "
--
-- PostgreSQL reports a column-level denial as `permission denied for TABLE
-- sources` with SQLSTATE 42501, which is why it read as a blanket access
-- problem, and the client mapped 42501 onto "access withdrawn".
--
-- WHAT IS STILL WITHHELD, and deliberately:
--
--   sources.connector_config    the retrieval strategy. Operational
--                               configuration, not something a reader needs.
--   sources.connector_id        same.
--   evidence.document_revision  not read by any surface.
--   evidence.superseded_at      not read by any surface; supersession is
--                               resolved server-side.
--   opportunities.opportunity_key, derived_by, derived_at
--                               not read by any surface.
--
-- Additive and reversible: a grant adds no column, changes no row, and drops no
-- constraint. Nothing about ingestion data is touched.

begin;

grant select (
    source_document_id,
    connector_id,
    connector_version,
    first_seen_at,
    last_seen_at,
    classification_status,
    review_status
) on evidence to authenticated;

grant select (last_success_at) on sources to authenticated;

commit;
