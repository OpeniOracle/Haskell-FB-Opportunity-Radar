-- =====================================================================
-- OPERATOR FILE -- migration 0022 (grant_live_ingestion_columns)
--
-- PRODUCTION HOTFIX. Every surface reports "Your access to the Radar has
-- been withdrawn" to users who are signed in, verified and allowlisted.
-- Nothing is wrong with any account: migration 0021 added columns and
-- migration 0015 grants SELECT column by column, so the browser cannot
-- read `sources.last_success_at` -- which `freshness()` reads on EVERY
-- surface -- and PostgreSQL refuses with 42501.
--
-- HOW TO RUN IT
--
--   Supabase Dashboard -> SQL Editor -> paste this ENTIRE file -> Run.
--   Or: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
--
--   Nothing to paste into it, nothing to substitute, nothing left out.
--
-- IT TOUCHES NO DATA. Two GRANT statements and one ledger row. It adds no
-- column, changes no row, drops no constraint, and cannot affect the 39
-- evidence records, 13 signals or 5 opportunities already collected.
--
-- ONE STATEMENT, so one transaction, whatever the SQL Editor does with
-- the script around it -- that editor does not keep one session across
-- the statements of a script, so an explicit begin/commit would not wrap
-- a multi-statement version of this file.
--
-- Any line containing ABORT: means NOTHING WAS COMMITTED.
--
-- CHECKSUM (whitespace-normalised per line, sha256 -- the rule
-- db/migrate.mjs uses, so a database migrated this way verifies clean)
--
--   0022  d387f082331a241a0419a1e07a72998b329ca2e621865865c2bf445e77077c72
-- =====================================================================

do $operator_0022$
begin
    -- ------------------------------------------------------------ preconditions
    if to_regclass('public.schema_migrations') is null then
        raise exception 'ABORT: there is no schema_migrations ledger.';
    end if;

    if exists (select 1 from public.schema_migrations where version = '0022') then
        raise exception 'ABORT: migration 0022 is already recorded. Nothing to do.';
    end if;

    if not exists (select 1 from public.schema_migrations where version = '0021') then
        raise exception 'ABORT: migration 0021 is not present. 0022 grants the columns 0021 added.';
    end if;

    if to_regclass('public.evidence') is null or to_regclass('public.sources') is null then
        raise exception 'ABORT: evidence or sources is missing.';
    end if;

-- >>>>>>>>>>>>>>>>>>>>>> CANONICAL PAYLOAD BEGINS <<<<<<<<<<<<<<<<<<<<<<
-- Verbatim from db/migrations/0022_grant_live_ingestion_columns.up.sql,
-- minus its own begin;/commit; lines.

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

-- >>>>>>>>>>>>>>>>>>>>>>> CANONICAL PAYLOAD ENDS <<<<<<<<<<<<<<<<<<<<<<<

    -- ------------------------------------------------------------- ledger row
    insert into public.schema_migrations (version, name, checksum, stamped)
    values ('0022', 'grant_live_ingestion_columns',
            'd387f082331a241a0419a1e07a72998b329ca2e621865865c2bf445e77077c72', false);

    -- ----------------------------------------------------------- postconditions
    -- The column every surface needs.
    if not exists (
        select 1 from information_schema.column_privileges
         where grantee = 'authenticated' and table_name = 'sources'
           and column_name = 'last_success_at' and privilege_type = 'SELECT'
    ) then
        raise exception 'ABORT: sources.last_success_at is still not granted.';
    end if;

    if (select count(*) from information_schema.column_privileges
         where grantee = 'authenticated' and table_name = 'evidence'
           and privilege_type = 'SELECT'
           and column_name in ('source_document_id','connector_id','connector_version',
                               'first_seen_at','last_seen_at','classification_status',
                               'review_status')) <> 7 then
        raise exception 'ABORT: the seven evidence columns are not all granted.';
    end if;

    -- STILL WITHHELD. Preserved content and operational configuration do not
    -- go to the browser, and this migration must not have widened that.
    if exists (
        select 1 from information_schema.column_privileges
         where grantee = 'authenticated' and privilege_type = 'SELECT'
           and ((table_name = 'evidence' and column_name in
                 ('body_text','archive_uri','raw_storage_uri','extracted_text_uri'))
             or (table_name = 'sources' and column_name = 'connector_config'))
    ) then
        raise exception 'ABORT: a withheld column became readable. Do not proceed.';
    end if;

    -- The allowlist stays unreadable by a signed-in session (migration 0016).
    if exists (
        select 1 from information_schema.table_privileges
         where grantee = 'authenticated' and table_name = 'auth_invite_allowlist'
           and privilege_type = 'SELECT'
    ) then
        raise exception 'ABORT: auth_invite_allowlist became readable.';
    end if;

    if (select count(*) from public.schema_migrations where version = '0022') <> 1 then
        raise exception 'ABORT: 0022 is not recorded exactly once.';
    end if;

    raise notice 'Migration 0022 applied. The interface can read what it asks for; nothing withheld became readable.';
end
$operator_0022$;
