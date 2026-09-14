-- Revoke the column grants added by 0022.
--
-- Reversible without loss: a grant holds no data. Rolling this back restores
-- the 0015 column list exactly, and the interface returns to reporting
-- "access withdrawn" on every surface -- which is the state this migration
-- exists to end, so roll back only deliberately.

begin;

revoke select (
    source_document_id,
    connector_id,
    connector_version,
    first_seen_at,
    last_seen_at,
    classification_status,
    review_status
) on evidence from authenticated;

revoke select (last_success_at) on sources from authenticated;

commit;
