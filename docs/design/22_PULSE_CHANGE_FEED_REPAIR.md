# 22 — Daily Pulse change feed: the read is repaired, and the market ledger is still empty

**Status:** Implemented in this change (read model, descriptions, Pulse surface, tests). **Date:** 2026-10-16.
**Closes:** the defect recorded in doc 21 §10.
**Not in scope, and not done:** no migration, no new column (in particular no `summary` column), no RLS or grant change, no production read or write, no deployment, no R2 schema work, no R3 classifier work. **Changes no accepted ADR.**

**The short answer to "can the application now display meaningful change history?"** For **connector and source operations: yes**, because the collector writes a real, readable ledger (`source_health_events`) and the feed now reads and describes it. For **market changes: not yet**, and this change cannot make it so. `change_events` is read correctly now, but **nothing in the repository writes to it** (§3), so until the scoring-and-promotion engine ADR 0007 assigns it to exists, the market side of the feed is empty because nothing has been recorded, and the page says exactly that.

---

## 1. The defect, in two layers

1. **The read could not succeed.** Daily Pulse selected `change_kind` and `summary` from `change_events`. The table has neither (`db/migrations/0012_change_events_and_audit.up.sql`). PostgreSQL answered `42703`, and the error was discarded, so the feed was silently empty for as long as the page has existed. Doc 21 made the failure visible; it did not fix it.
2. **The mapping would have been wrong even if it had succeeded.** Every row was given `kind: 'evidence_added'` and `channel: 'market'`, with the missing `summary` as its title, and the raw column text as its subject. A connector failure and a project promotion would have been the same row.

## 2. What the schema, RLS and grants allow

| Table | Columns | Read grant | Row policy |
|---|---|---|---|
| `change_events` | `id, object_type, object_id, change_type, from_state, to_state, materiality, dedupe_key, scoring_version, actor_type, occurred_at` | `grant select on change_events to authenticated` (0015 line 150), **table level**, so every column | `change_events_read_authenticated … using (true)` |
| `source_health_events` | `id, source_id, source_run_id, prior_status, new_status, event_type, summary, coverage_impact, action_required, resolved_at, created_at` | `grant select on source_runs, source_run_attempts, source_health_events to authenticated` (0015 line 148), **table level** | `source_health_events_read_authenticated … using (true)` |

**No grant limitation was found.** Every column the repaired queries name is readable by `authenticated`, no later migration (0021–0024) revokes or narrows either grant, and nothing here asks for a broader one. `change_events.object_type` is checked against `opportunity | signal | market_trend | facility | organization | source`, `materiality` against `material | minor | silent`; **`change_type` has no CHECK** and is free text. Neither table has a `summary` column except `source_health_events`, where it is written by the collector.

Row-level security **withholds rows silently**: a policy that hid every row would read exactly like an empty table. This change cannot distinguish the two and does not claim to (§8).

## 3. What is actually written

| Ledger | Writer | What it writes |
|---|---|---|
| `change_events` | **None.** No application code inserts into it and no database trigger does; the only `insert into change_events` in the repository is a constraint test in `db/test.mjs`. ADR 0007 (status *Proposed*) gives the table to "the scoring and promotion engine and the classification pipeline"; neither exists | Nothing, so the table is empty in any database the application populates |
| `source_health_events` | The connector runner, `app/netlify/functions/_shared/connectors/runner.ts`, `recordSourceOutcome` (line 335) | Every health **transition**, and every run it **abandons, skips, defers or blocks** (`always: true`), each with its own plain-language `summary` and, where a person is needed, an `action_required` payload |
| `opportunity_status_history` | None (no application code, no trigger). Status is not yet changed by anything in the application | Nothing |

**Event types actually persisted.** Operational: `status_change` and `failure` (lines 611, 973), `run_abandoned` (445), `blocked_egress` (829), `deferred_time_budget` (854) and `skipped_overlap` (876, 938). **Market: none observed**, because there is no writer. These are determined from the code. **No production rows were read** to establish them; if you want the observed distribution, §10 gives a read-only query to run.

Of those, the operational events are system operations. None is evidence ingestion or market intelligence, and none is labelled as such.

## 4. The reading contract

The pure module `app/src/lib/changeFeed.ts` holds the vocabulary, validates every row and builds every sentence. **Which ledger a row came from decides its channel**, never its text.

### Market ledger (`change_events`, channel `market`)
Because no writer exists, this vocabulary is a **reading contract**, not an observed distribution. Each identifier's provenance:

| `change_type` | Defined for | Provenance of the name | Description (what the row can support) |
|---|---|---|---|
| `stage_promoted` | opportunity | migration 0012 column comment; `ChangeKind` | "Stage promoted" + `Stage: Emerging → Developing.` using `from_state.stage` / `to_state.stage` **only when each is a valid stage** |
| `stage_demoted` | opportunity | ADR 0007 ("stage promotion or demotion"), same spelling pattern | same, "Stage demoted" |
| `status_changed` | opportunity | ADR 0007 ("status change") | "Status changed" + `Status: New → Watching.` from valid `status` values |
| `closed` | opportunity | migration 0012 column comment | "Closed" + the status **only if it is a closing status**; otherwise "Recorded as closed; the outcome is not stated." |
| `evidence_added` | opportunity, signal, organization | migration 0012 comment; `ChangeKind` | "New evidence" + "New evidence was recorded for this *x*." |
| `facility_resolved` | opportunity, organization, facility | `ChangeKind`; ADR 0007 ("first facility resolution") | "Facility resolved" |
| `negative_signal` | signal, opportunity, organization | `ChangeKind`; ADR 0007 ("negative-signal arrival") | "Negative signal" |

The three literally named in the repository are `stage_promoted`, `evidence_added` and `closed`; `facility_resolved` and `negative_signal` are named by the application's own `ChangeKind`; `stage_demoted` and `status_changed` follow ADR 0007's materiality list.

### Operational ledger (`source_health_events`, channel `system`)
* **Recovery:** prior status in `degraded | action_required | manual_review_required | source_unavailable` → `healthy`: *Source recovered*.
* **Failure:** a transition **into** one of those: *Source degraded / needs action / needs manual review / unavailable*.
* **Other transition** (for example a source being enabled): *Source status changed*.
* **No change of status**, one of the collector's own run notices: *Collection failed / run abandoned / blocked / run skipped / deferred*.
* The sentence is the transition plus the collector's **own `summary`, repeated and shortened to 280 characters**, never rewritten. An `action_required` payload becomes the collector's own action in words ("An operator import is needed for this source."), and the host list is **not** repeated.

### Rules, all explicit and all tested
1. **Pulse lists `materiality = 'material'` only** (ADR 0007; also what the partial index `change_events_recent_idx` serves). The filter is in the query, so the 25-row bound applies to listable rows.
2. **A state field is used only if it is in the vocabulary.** A stage `unicorn`, a status `platinum`, a non-object `to_state` or free text inside a state is ignored, and the sentence gets shorter ("The recorded change does not say which stages."). Free text inside `from_state`/`to_state` is **never repeated**.
3. **Never the clock, never a guess.** The time is the row's own; a row with no parseable timestamp is not listed. A subject is named from records the page already holds; a record it cannot find is "(record not found)" when its read was whole and "(record not loaded)" when it was cut short (the same honesty as doc 21 §4). An opportunity is linked only if the page holds it.
4. **No commercial significance.** `needsAttention` is `false` and `actionHint` is `null` for every market change. Whether a change calls for action is a judgement about an account and a position, and the ledger carries `materiality`, which only decides whether the change is listed. So the live feed never populates "Needs attention today". (The fixtures' "worth a pursuit decision this week" is illustrative text and is not reachable from the live path.)
5. **Unsupported rows are counted, not relabelled.** An unrecognised `change_type` or `event_type`, a known type on an object it is not defined for, or a row with a missing id, timestamp or object is left out and counted. Pulse says "*N* recorded changes were not listed because this page cannot describe them yet." Relabelling to the nearest known type is exactly how every row once became `evidence_added`.

## 5. The queries

```
change_events        select id, object_type, object_id, change_type, from_state, to_state,
                            materiality, actor_type, occurred_at
                     where materiality = 'material'
                     order by occurred_at desc nulls last, id     limit 25

source_health_events select id, source_id, prior_status, new_status, event_type, summary,
                            action_required, created_at
                     order by created_at desc nulls last, id      limit 25
```

Each is the newest 25 of its ledger with a unique tail, so the cut is the same on every read; the merged feed is the newest 25 of the **union** (ordered by instant, then id), which is always contained in what was read. Both reads run in parallel. **One request is added** (Pulse: 10 → 11); each is bounded by 25 and neither asks for a count (a slice on purpose needs no total). `dedupe_key`, `scoring_version`, `coverage_impact` and `resolved_at` are not selected.

## 6. Empty, inaccessible and failed are different states

| What happened | What the page shows | `completeness` |
|---|---|---|
| Both ledgers answered with nothing | "**No changes have been recorded yet.**" | `limited` (not a fault), complete |
| Rows exist that the page cannot describe | "*N* recorded changes were not listed because this page cannot describe them yet." | complete; `changeFeed.notListed = N` |
| A read was refused (`42501`) | the notice: "The *market changes* could not be read: a database permission is missing. Your access is unaffected; this is a deployment fault." | `failed`, `reason: not_permitted` |
| A table is not there yet (`42P01`, or an undefined column `42703`, which `classifyError` already treats as a pending migration) | "…are not available yet: a database migration is outstanding." | `failed`, `not_migrated` |
| A rejected session | "…could not be read: the session was not accepted." | `failed`, `unauthorized` |
| Anything else, or a request that rejects outright | "The *market changes* could not be read." | `failed`, `error` |

"Empty" is claimed only when **both** reads succeeded and neither held a thing. A failed or refused ledger never produces the empty line, and the other ledger and the rest of the page still render. The reasons reuse `classifyError`, so the two cannot disagree about what a SQLSTATE means.

## 7. Tests

* `app/src/test/changeFeed.test.ts` (144 cases). **The vocabulary is pinned to the repository's own sources:** the column lists are compared with the DDL parsed from the migrations; the object types, the materiality value and the health statuses are compared with their CHECK constraints; and **every `event_type` `runner.ts` writes must be described**, so a new one cannot be added undescribed. Descriptions are tested for each type and state combination, status transitions, new evidence, source failure and recovery, unsupported types (including `constructor` / `__proto__`), missing related records, malformed rows, no invented summary or implication across the full type × object grid, empty feed, permission / migration / session / generic / rejected failures, and stable ordering (shuffled database order, equal timestamps, mixed UTC offsets, the 25-row bound over the union).
* `app/src/test/changeFeedSurface.test.tsx` (15 cases) renders the real page: market and system rows in their own sections, the empty line, the not-listed count, each failure sentence, the collector's action hint, and the absence of "Needs attention today" and of any commercial wording.
* The PostgREST-shaped fake from doc 21 now takes a `schema` and rejects a column the table does not have, which is what the original read would have tripped. **Three mutations were checked to fail the suite:** restoring the invalid columns, labelling everything `evidence_added`, and dropping the materiality filter.
* Doc 21's suites were updated for the real columns and the extra request; the R1.5 harness is untouched.

## 8. Remaining limitations

1. **Nothing writes `change_events`.** The market feed is empty until a writer exists, and the vocabulary above is a contract for that writer, not something observed. This change does not create one.
2. **`from_state` / `to_state` have no documented shape.** Only `stage` and `status` keys are read, and only when valid. A writer that records transitions differently will produce the shorter "does not say which" sentences until the shape is agreed.
3. **RLS is invisible.** A policy that hides rows reads as empty. Only a missing privilege (`42501`) can be told apart.
4. **`opportunity_status_history` is not read.** It has the richer status record (actor, reason code) but no writer either.
5. **`source_health_events` are history, not state.** A "degraded" row from last week is still a row. `resolved_at` is not read; current health stays on the page's own source figures.
6. **Facilities and market trends are not read by this page**, so a change on one is named by its kind only.
7. **`classifyError` calls an undefined column `not_migrated`** ("a database migration is outstanding"). That is a reasonable reading for a database that is behind the code, but it is not specific to tables.
8. **No per-user "since your last visit".** `lastVisitAt` is still null; `user_read_state` is not read.
9. **No significance.** Without a recorded judgement the feed cannot rank by importance, so it is newest-first only.

## 9. Recommended next step

Build the **writer**, as its own change, before any more reading: the scoring-and-promotion step ADR 0007 names emits one `change_events` row per decided change, with `from_state` / `to_state` in an agreed shape (`{ "stage": … }`, `{ "status": … }`), a `materiality`, and a `dedupe_key`. When it does, this change's vocabulary table becomes its test oracle, and the feed starts showing market history with no read-side change. Decide the state-JSON shape with it.

## 10. To observe the real distribution (read-only; not run by this change)

```sql
select 'change_events' as ledger, change_type as kind, materiality, count(*), min(occurred_at), max(occurred_at)
  from change_events group by 1, 2, 3
union all
select 'source_health_events', event_type || ' (' || coalesce(prior_status,'-') || ' -> ' || new_status || ')', null,
       count(*), min(created_at), max(created_at)
  from source_health_events group by 1, 2, 3
order by 1, 2;
```
