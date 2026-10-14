-- =====================================================================
-- OPERATOR FILE -- remediation 2026-10 (ingestion integrity)
--
-- DATA REMEDIATION. NOT A MIGRATION. NO SCHEMA CHANGES. NOT APPLIED BY CI,
-- BY A DEPLOY, OR BY ANY FUNCTION. It runs only when an operator, holding a
-- separate written authorization, runs it.
--
-- WHAT IT CORRECTS, in the production database only, and nothing else:
--
--   1. THE STALLED MARS RUN. source_runs 2925eada-3f3f-43e9-9279-445b202e6543
--      (mars-newsroom, started 2026-09-14 05:23:06.215 UTC) has been
--      `running` since its invocation was ended by Netlify's 60-second limit.
--      It is closed as a failure with error_code = 'abandoned'. If the runner
--      shipped in Phase 2 PR 1 has already done that, this step finds it done
--      and leaves it alone.
--
--   2. FULL COPYRIGHTED PAGES STORED AGAINST A REFERENCE-ONLY SOURCE.
--      The 53 mars-newsroom evidence rows carry complete page text in
--      `body_text` under access_mode 'structured_primary', because the
--      pipeline hard-coded that mode. ADR 0014 retains corporate newsroom
--      material by reference only. Each row has `body_text` set to NULL and
--      `access_mode` set to 'reference_only', and records that it was
--      remediated in `evidence_locator`. KEPT, untouched: id,
--      source_document_id, content_hash, URLs, title, published_at,
--      retrieved_at, first_seen_at, the bounded excerpt, and every link from
--      signals. Nothing is deleted.
--
--   3. MARS SOURCE HEALTH. mars-newsroom reads 'healthy' with
--      last_success_at NULL: it has never completed a run. If no Mars run has
--      completed successfully, its health is set to 'action_required'. If one
--      has (the PR 1 runner may have run Mars since), the health that run
--      derived is left as it is.
--
-- WHAT IT DOES NOT DO
--
--   - It touches no other source, no other source's runs, no other evidence,
--     no signal or opportunity text beyond holding Mars-linked excerpt copies
--     to the reference-only bound (500 characters; none exceeded it when this
--     file was written), and no schema object. A postcondition proves the
--     unrelated rows are byte-identical before and after.
--   - It does NOT purge anything from Supabase backups, point-in-time
--     recovery, write-ahead log archives, or any export an operator may hold.
--     Those still contain the page text and need their own review -- see
--     docs/HOSTED_VALIDATION_RUNBOOK.md section G.
--
-- HOW TO RUN IT
--
--   Supabase Dashboard -> SQL Editor -> paste this ENTIRE file -> Run.
--   Or: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
--
--   Nothing to paste into it, nothing to substitute.
--
-- ONE STATEMENT, so one transaction, whatever the SQL Editor does with the
-- script around it. Any line containing ABORT: means NOTHING WAS COMMITTED.
--
-- REPEAT APPLICATION REFUSES. The run is recorded in audit_events under
-- request_id 'remediation-2026-10-ingestion-integrity'; a second run finds
-- that row and aborts before changing anything.
-- =====================================================================

do $remediation_2026_10$
declare
    c_marker        constant text := 'remediation-2026-10-ingestion-integrity';
    c_source        constant text := 'mars-newsroom';
    c_run_id        constant uuid := '2925eada-3f3f-43e9-9279-445b202e6543';
    c_run_started   constant timestamptz := '2026-09-14 05:23:06.215+00';
    c_expected_rows constant integer := 53;
    c_excerpt_max   constant integer := 500;
    c_now           constant timestamptz := now();

    v_run_status       text;
    v_run_error        text;
    v_run_closed_here  boolean := false;
    v_rows_total       integer;
    v_rows_target      integer;
    v_rows_objects     integer;
    v_rows_changed     integer;
    v_ids              uuid[];
    v_hashes           jsonb;
    v_health_before    text;
    v_failures_before  integer;
    v_health_after     text;
    v_has_success      boolean;
    v_signals_trimmed  integer;
    v_opps_trimmed     integer;

    -- Fingerprints of everything this file must NOT change.
    fp_other_evidence_before  text;
    fp_other_sources_before   text;
    fp_other_runs_before      text;
    fp_mars_identity_before   text;
begin
    -- ------------------------------------------------------------ preconditions
    if to_regclass('public.schema_migrations') is null then
        raise exception 'ABORT: there is no schema_migrations ledger. Is this the Radar database?';
    end if;
    if not exists (select 1 from public.schema_migrations where version = '0021') then
        raise exception 'ABORT: migration 0021 is not applied; this database predates the rows this file corrects.';
    end if;

    if exists (select 1 from public.audit_events where request_id = c_marker) then
        raise exception 'ABORT: this remediation is already recorded in audit_events (request_id %). Nothing to do.', c_marker;
    end if;

    -- The premise: the registry says the source is reference-only. If it says
    -- anything else, removing bodies is not this file's decision to make.
    if not exists (
        select 1 from public.sources where id = c_source and access_mode = 'reference_only'
    ) then
        raise exception 'ABORT: source % is missing or is not access_mode reference_only in the registry.', c_source;
    end if;

    -- The stalled run, identified exactly: id, source and start time. It must
    -- be either still running (not yet recovered) or already closed as
    -- abandoned by the PR 1 runner. Any other state is not one this file was
    -- written for.
    select run_status, error_code into v_run_status, v_run_error
      from public.source_runs
     where id = c_run_id and source_id = c_source and started_at = c_run_started;
    if not found then
        raise exception 'ABORT: the stalled run % (source %, started %) is not present.', c_run_id, c_source, c_run_started;
    end if;
    if not (v_run_status = 'running' or (v_run_status = 'failure' and v_run_error = 'abandoned')) then
        raise exception 'ABORT: run % is in state %/% -- neither still running nor closed as abandoned.',
            c_run_id, v_run_status, coalesce(v_run_error, 'no error code');
    end if;

    select count(*) into v_rows_total from public.evidence where source_id = c_source;
    select count(*) into v_rows_target
      from public.evidence
     where source_id = c_source and (body_text is not null or access_mode <> 'reference_only');
    if v_rows_target <> c_expected_rows then
        raise exception 'ABORT: expected exactly % mars-newsroom evidence rows holding a body or a non-reference mode; found %. The database has changed since this file was written; review before running.',
            c_expected_rows, v_rows_target;
    end if;

    -- A stored object would be a copy this file cannot remove from SQL.
    select count(*) into v_rows_objects
      from public.evidence
     where source_id = c_source
       and (archive_uri is not null or raw_storage_uri is not null or extracted_text_uri is not null);
    if v_rows_objects > 0 then
        raise exception 'ABORT: % mars-newsroom evidence rows reference a Storage object. Those objects need review and removal first; this file only corrects database rows.', v_rows_objects;
    end if;

    -- -------------------------------------------------------- before-state
    select coalesce(md5(string_agg(row_to_json(e)::text, '|' order by e.id)), '')
      into fp_other_evidence_before
      from public.evidence e where e.source_id <> c_source;
    select coalesce(md5(string_agg(row_to_json(s)::text, '|' order by s.id)), '')
      into fp_other_sources_before
      from public.sources s where s.id <> c_source;
    select coalesce(md5(string_agg(row_to_json(r)::text, '|' order by r.id)), '')
      into fp_other_runs_before
      from public.source_runs r where r.id <> c_run_id;
    select coalesce(md5(string_agg(
               concat_ws('|', e.id, e.source_document_id, e.content_hash, e.original_url,
                         e.canonical_url, e.title, e.published_at, e.retrieved_at,
                         e.first_seen_at, e.superseded_at),
               '||' order by e.id)), '')
      into fp_mars_identity_before
      from public.evidence e where e.source_id = c_source;

    select array_agg(id order by id),
           jsonb_object_agg(id::text, content_hash)
      into v_ids, v_hashes
      from public.evidence
     where source_id = c_source and (body_text is not null or access_mode <> 'reference_only');

    select health_status, consecutive_failures into v_health_before, v_failures_before
      from public.sources where id = c_source;

    -- ------------------------------------------------- 1. the stalled run
    if v_run_status = 'running' then
        update public.source_runs
           set status = 'failed',
               run_status = 'failure',
               completed_at = c_now,
               error_code = 'abandoned',
               error_summary = 'Run abandoned: the invocation holding it was ended by the platform on 2026-09-14 '
                            || 'and never closed it. Closed by operator remediation ' || c_marker || '. '
                            || 'Documents it stored before ending are kept.'
         where id = c_run_id and run_status = 'running';
        get diagnostics v_rows_changed = row_count;
        if v_rows_changed <> 1 then
            raise exception 'ABORT: closing run % changed % rows, expected 1.', c_run_id, v_rows_changed;
        end if;
        v_run_closed_here := true;
    end if;

    -- ------------------------------- 2. bodies held against reference-only
    update public.evidence
       set body_text = null,
           access_mode = 'reference_only',
           evidence_excerpt = case
               when evidence_excerpt is not null and length(evidence_excerpt) > c_excerpt_max
               then left(evidence_excerpt, c_excerpt_max)
               else evidence_excerpt end,
           evidence_locator = coalesce(evidence_locator, '{}'::jsonb) || jsonb_build_object(
               'accessModeRemediated', jsonb_build_object(
                   'from', access_mode,
                   'to', 'reference_only',
                   'bodyRemoved', body_text is not null,
                   'at', c_now,
                   'by', c_marker,
                   'reason', 'ADR 0014: corporate newsroom material is retained by reference only'))
     where source_id = c_source
       and id = any (v_ids);
    get diagnostics v_rows_changed = row_count;
    if v_rows_changed <> c_expected_rows then
        raise exception 'ABORT: the evidence update changed % rows, expected %.', v_rows_changed, c_expected_rows;
    end if;

    -- Excerpt copies on signals and opportunities derived from Mars evidence,
    -- held to the same bound. A no-op on the data this file was written for.
    update public.signals g
       set summary = left(g.summary, c_excerpt_max)
     where length(g.summary) > c_excerpt_max
       and exists (select 1 from public.signal_evidence se
                     join public.evidence e on e.id = se.evidence_id
                    where se.signal_id = g.id and e.source_id = c_source);
    get diagnostics v_signals_trimmed = row_count;

    update public.opportunities o
       set executive_summary = left(o.executive_summary, c_excerpt_max)
     where length(o.executive_summary) > c_excerpt_max
       and exists (select 1 from public.opportunity_signals os
                     join public.signal_evidence se on se.signal_id = os.signal_id
                     join public.evidence e on e.id = se.evidence_id
                    where os.opportunity_id = o.id and e.source_id = c_source);
    get diagnostics v_opps_trimmed = row_count;

    -- ------------------------------------------------ 3. Mars source health
    select exists (
        select 1 from public.source_runs
         where source_id = c_source and run_status in ('success', 'unchanged', 'partial_success')
    ) into v_has_success;

    if v_has_success then
        v_health_after := v_health_before;
    else
        v_health_after := 'action_required';
        update public.sources
           set health_status = 'action_required',
               consecutive_failures = case when v_run_closed_here
                                           then consecutive_failures + 1
                                           else consecutive_failures end,
               updated_at = c_now
         where id = c_source;
    end if;

    insert into public.source_health_events
        (source_id, source_run_id, prior_status, new_status, event_type, summary,
         coverage_impact, action_required)
    values
        (c_source, c_run_id, v_health_before, v_health_after, 'operator_remediation',
         'Operator remediation ' || c_marker || ': stalled run ' ||
         case when v_run_closed_here then 'closed as abandoned' else 'already closed as abandoned' end ||
         '; full page text removed from ' || c_expected_rows || ' reference-only evidence rows; ' ||
         case when v_has_success then 'health left as derived by the last completed run.'
              else 'no completed Mars run exists, so health is action_required.' end,
         jsonb_build_object('evidenceRowsCorrected', c_expected_rows, 'runClosedHere', v_run_closed_here),
         case when v_has_success then null
              else jsonb_build_object('action', 'repair_newsroom_connector',
                                      'detail', 'Mars has never completed a run; see audit F-8 (article filtering, dates).') end);

    -- ------------------------------------------------------------ audit row
    insert into public.audit_events
        (actor_type, actor_id, action, object_type, object_id,
         before_state, after_state, reason, request_id, surface)
    values
        ('system', 'operator', 'remediate_ingestion_integrity', 'source', c_source,
         jsonb_build_object(
             'stalledRun', jsonb_build_object('id', c_run_id, 'runStatus', v_run_status, 'errorCode', v_run_error),
             'evidenceRows', c_expected_rows,
             'evidenceIds', to_jsonb(v_ids),
             'contentHashes', v_hashes,
             'accessMode', 'structured_primary (body retained)',
             'health', v_health_before,
             'consecutiveFailures', v_failures_before),
         jsonb_build_object(
             'stalledRun', jsonb_build_object('id', c_run_id, 'runStatus', 'failure', 'errorCode', 'abandoned',
                                              'closedHere', v_run_closed_here),
             'accessMode', 'reference_only (body removed)',
             'health', v_health_after,
             'signalsTrimmed', v_signals_trimmed,
             'opportunitiesTrimmed', v_opps_trimmed),
         'Phase 2 PR 1 remediation: ADR 0014 reference-only retention for the Mars newsroom, '
         || 'and recovery of the run stalled since 2026-09-14. Page text removed from the live rows only; '
         || 'backups and point-in-time recovery are NOT purged by this file.',
         c_marker, 'operator_sql');

    -- ----------------------------------------------------------- postconditions
    if exists (select 1 from public.source_runs where id = c_run_id and run_status = 'running') then
        raise exception 'ABORT: postcondition failed -- run % is still running.', c_run_id;
    end if;
    if exists (select 1 from public.evidence where source_id = c_source and body_text is not null) then
        raise exception 'ABORT: postcondition failed -- a mars-newsroom row still holds a body.';
    end if;
    if exists (select 1 from public.evidence where source_id = c_source and access_mode <> 'reference_only') then
        raise exception 'ABORT: postcondition failed -- a mars-newsroom row is not reference_only.';
    end if;
    if (select count(*) from public.evidence where source_id = c_source) <> v_rows_total then
        raise exception 'ABORT: postcondition failed -- the number of mars-newsroom evidence rows changed.';
    end if;
    if exists (select 1 from public.evidence
                where source_id = c_source and length(evidence_excerpt) > c_excerpt_max) then
        raise exception 'ABORT: postcondition failed -- a mars-newsroom excerpt exceeds % characters.', c_excerpt_max;
    end if;

    -- Identity and history of the corrected rows: unchanged.
    if (select coalesce(md5(string_agg(
               concat_ws('|', e.id, e.source_document_id, e.content_hash, e.original_url,
                         e.canonical_url, e.title, e.published_at, e.retrieved_at,
                         e.first_seen_at, e.superseded_at),
               '||' order by e.id)), '')
          from public.evidence e where e.source_id = c_source) <> fp_mars_identity_before then
        raise exception 'ABORT: postcondition failed -- the identity or history of a mars-newsroom row changed.';
    end if;

    -- Everything unrelated: byte-identical.
    if (select coalesce(md5(string_agg(row_to_json(e)::text, '|' order by e.id)), '')
          from public.evidence e where e.source_id <> c_source) <> fp_other_evidence_before then
        raise exception 'ABORT: postcondition failed -- evidence from another source changed.';
    end if;
    if (select coalesce(md5(string_agg(row_to_json(s)::text, '|' order by s.id)), '')
          from public.sources s where s.id <> c_source) <> fp_other_sources_before then
        raise exception 'ABORT: postcondition failed -- another source row changed.';
    end if;
    if (select coalesce(md5(string_agg(row_to_json(r)::text, '|' order by r.id)), '')
          from public.source_runs r where r.id <> c_run_id) <> fp_other_runs_before then
        raise exception 'ABORT: postcondition failed -- another run changed.';
    end if;

    if (select count(*) from public.audit_events where request_id = c_marker) <> 1 then
        raise exception 'ABORT: postcondition failed -- the audit record is not exactly one row.';
    end if;

    raise notice 'Remediation % applied: run % %; % evidence rows set reference_only with no body; mars-newsroom health % -> %.',
        c_marker, c_run_id,
        case when v_run_closed_here then 'closed as abandoned' else 'was already abandoned' end,
        c_expected_rows, v_health_before, v_health_after;
end
$remediation_2026_10$;
