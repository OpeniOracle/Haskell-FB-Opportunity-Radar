-- 0014  Non-scoring evaluation and replay structures
--
-- Everything here is recorded and NOTHING here decides anything. Each table is
-- either an input to a decision that has not been made yet, or a log of what a
-- later phase did.
--
-- C25  MODEL REPLAY CACHE. The v0.1 key — content hash, prompt version, model,
--      schema version — is incomplete, and an incomplete cache key is worse than
--      no cache: it serves stale output as though it were fresh.
--      `structured_context_digest` is the field most easily forgotten and the
--      most dangerous. Classification prompts include resolved account and
--      facility context, so the same article legitimately classifies differently
--      once a facility resolves. Without it in the key, the cache pins the
--      pre-resolution answer forever.
--
--      No model is called in this PR. This is where one would write.

create table model_replay_cache (
    replay_key                  char(64) primary key,   -- hash of every column below
    content_hash                char(64) not null,
    preprocessing_version       text not null,          -- extractor / OCR version
    task                        text not null,
    provider                    text not null,
    model                       text not null,
    model_parameters            jsonb not null,         -- temperature, top_p, max_tokens, seed, tools
    system_instructions_hash    char(64) not null,
    prompt_version              text not null,
    schema_version              text not null,
    taxonomy_version            text not null,
    structured_context_digest   char(64) not null,
    output                      jsonb not null,
    output_valid                boolean not null,
    created_at                  timestamptz not null default now(),
    last_hit_at                 timestamptz,
    constraint model_replay_cache_task_check
        check (task in ('extract', 'classify', 'align', 'summarize', 'cluster'))
);

-- Components are stored alongside the hash so that a version bump can be scoped
-- precisely: "reprocess everything affected by taxonomy v3" is a query, not a
-- full recompute.
create index model_replay_cache_taxonomy_idx on model_replay_cache (taxonomy_version);
create index model_replay_cache_prompt_idx on model_replay_cache (task, prompt_version);
create index model_replay_cache_content_idx on model_replay_cache (content_hash);

-- Provisional ranking hypotheses. EXPLICITLY NON-SCORING: `enabled` cannot be
-- true without an evaluation corpus, and no corpus exists. A hypothesis that
-- could be switched on before it was measured is not a hypothesis, it is a
-- change to the ranking model made without evidence.
create table evaluation_corpora (
    id              uuid primary key default gen_random_uuid(),
    name            text not null unique,
    description     text not null,
    assembled_by    text not null,
    assembled_at    timestamptz not null default now(),
    entry_count     integer not null default 0,
    check (entry_count >= 0)
);

create table ranking_hypotheses (
    id                      uuid primary key default gen_random_uuid(),
    name                    text not null unique,
    description             text not null,
    component_event_types   text[] not null default '{}',
    proposed_by             text not null,
    evidence_basis          text not null,
    enabled                 boolean not null default false,
    evaluation_corpus_id    uuid references evaluation_corpora(id),
    created_at              timestamptz not null default now(),
    constraint ranking_hypotheses_enable_requires_corpus
        check (enabled = false or evaluation_corpus_id is not null)
);
comment on table ranking_hypotheses is
    'Non-scoring. Nothing reads these in Phase 1; a hypothesis cannot be enabled without a measured corpus.';

-- E15  Negative controls belong in the corpus: cancelled projects and lost-bid
--      sites. A site-selection evaluation legitimately produces signals at
--      several locations, only one of which becomes a project. A corpus of
--      positives only measures how well the platform agrees with itself.
create table evaluation_corpus_entries (
    id                      uuid primary key default gen_random_uuid(),
    corpus_id               uuid not null references evaluation_corpora(id) on delete cascade,
    entry_kind              text not null,
    subject                 text not null,
    outcome                 text not null,
    outcome_date            date,
    outcome_date_precision  text not null default 'unknown',
    citation_url            text,
    citation_status         text not null default 'uncited',
    created_at              timestamptz not null default now(),
    constraint evaluation_corpus_entries_kind_check
        check (entry_kind in ('positive', 'negative_control')),
    constraint evaluation_corpus_entries_precision_check
        check (outcome_date_precision in ('exact_day', 'month', 'quarter', 'season',
                                          'half_year', 'year', 'range', 'relative', 'unknown')),
    constraint evaluation_corpus_entries_citation_status_check
        check (citation_status in ('uncited', 'cited', 'verified')),
    -- A corpus entry that claims a citation must carry one, or the corpus
    -- measures the platform against unverifiable assertions.
    constraint evaluation_corpus_entries_citation_present
        check (citation_status = 'uncited' or citation_url is not null)
);

create index on evaluation_corpus_entries (corpus_id, entry_kind);
