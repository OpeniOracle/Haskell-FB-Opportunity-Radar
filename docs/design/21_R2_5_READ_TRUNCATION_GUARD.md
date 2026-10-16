# 21 — R2.5: the read-truncation guard

**Status:** Implemented in this change (read model, interface, tests). **Date:** 2026-10-16.
**Scope:** roadmap item R2.5 in doc 20 §3. **Not** R2 (schema) and **not** R3 (derivation). No migration, no RLS or grant change, no connector, no production data, no deployment.
**Changes no accepted ADR.**

The primary objective is **honest reporting**. This change does not make the reads complete; it makes the application say when they are not.

---

## 1. The defect

The browser read model loads whole tables with `.limit(1000)` and builds every page from the rows that come back. PostgREST (Supabase) also applies its own server-side `max_rows`, which ships at 1,000. Past that point the database returns the first N rows **and says nothing**, so:

* a headline of "1,000 documents" sits beside 1,500 stored records;
* an opportunity shows fewer documents than it has, because the `signal_evidence` rows that link them fell past the cap;
* an account is reported as uncovered ("has not produced a signal") because the link that would have covered it was never loaded;
* "No such opportunity" is shown for an opportunity that exists but sorted past the cap.

None of these was wrong in the database. All of them were wrong on the page, and nothing on the page said so. Before this change none of the eight reads in `readGraph` had an `ORDER BY`, so which 1,000 rows survived was also undefined, and could differ between two loads.

## 2. What ordering does and does not do

> **Ordering a query makes the rows a capped read keeps the *same* rows each time. It does not make the result complete, and nothing in this change treats the two as the same thing.**

Every capped read now ends in a unique tail, so no two rows can tie and the cut falls in the same place on every load. Whether the kept rows are *all* the rows is answered separately, by the database's own count (§3).

| Read | Order | Unique tail | Why this order |
|---|---|---|---|
| `organizations` | `canonical_name`, `id` | `id` | stable alphabetical list |
| `opportunities` | `last_material_change_at` desc nulls last, `id` | `id` | if rows are lost, the oldest go first |
| `signals` | `first_observed_at` desc nulls last, `id` | `id` | same |
| `evidence` | `retrieved_at` desc nulls last, `id` | `id` | same |
| `opportunity_signals` | `opportunity_id`, `signal_id` | composite primary key | a link table has no `id` |
| `signal_evidence` | `signal_id`, `evidence_id` | composite primary key | same |
| `sources` | `id` | `id` | |
| `account_source_expectations` | `organization_id`, `source_family` | unique key | |
| `source_runs` (Source Health) | `started_at` desc nulls last, `id` | `id` | |
| `organization_locations`, `opportunity_locations` (Map) | `id` | `id` | |
| `change_events` (Pulse) | `occurred_at` desc, `id` | `id` | bounded to the latest 25 on purpose |

Only **already-selected, already-granted** columns are used for ordering. No column was added to a `select`, so no column grant is implied (0015 / 0022 are untouched; `body_text`, `archive_uri`, `raw_storage_uri` and `extracted_text_uri` stay unselected).

The two link tables are ordered by their keys, not by recency, deliberately: they carry no timestamp that is both selected and granted, and a key order is deterministic. It does mean a truncated link table loses links by key, not by age — which is exactly why §5 treats *every* count that passes through a truncated link table as a floor.

## 3. How truncation is detected

Each capped read asks the database for its own total **in the same request**: `.select(cols, { count: 'exact' })`. PostgREST returns it in `Content-Range`; supabase-js exposes it as `count`. No extra request is made.

`reportRead(dataset, returned, count, limit)` (`app/src/lib/completeness.ts`) then compares the rows that came back with **the database's total** — never with the limit the client asked for. (A server that caps at 500 hands a client that asked for 1,000 only 500 rows; comparing with the client's own limit would call that read whole.)

| Condition | Status | Treated as |
|---|---|---|
| `returned === total` (including exactly 1,000 of 1,000, and 0 of 0) | `complete` | whole |
| `returned < total` | `truncated` | **incomplete** — "Showing 1,000 of 1,500 evidence records." |
| `count` is `null`, `undefined`, negative, fractional, `NaN`, infinite or a string — or `total < returned` | `indeterminate` | **incomplete** — "Could not confirm that all X were loaded (N came back)." |
| the request errored | `failed` | the surface becomes `unavailable`, or, for the one non-fatal read (`change_events`), carries `failed` and renders |
| the read asks for a bounded slice on purpose (`change_events`, latest 25) | `limited` | **not** a fault; the feed says "latest 25 changes only" |

A missing count is never read as zero, and "fewer rows than the limit" is never read as "complete". Exactly 1,000 rows with no total is `indeterminate`, because 1,000 is also precisely what a truncated read returns.

## 4. How incomplete totals and relationships are represented

`SurfaceState<T>` gained one optional field, `completeness?: ReadCompleteness`:

```ts
interface ReadCompleteness { complete: boolean; datasets: DatasetReadReport[] }
interface DatasetReadReport {
  dataset: DatasetKey; label: string
  status: 'complete' | 'truncated' | 'indeterminate' | 'limited' | 'failed'
  returned: number; total: number | null; limit: number
}
```

It is **orthogonal** to `kind`: `degraded` and `stale` describe the sources' health and freshness; `completeness` describes whether the rows the page was built from were all of them. The fixture data source does not set it (absent means "no claim is made"), so fixtures and the real read are distinguishable and nothing about fixtures changes.

A figure is **exact** only if every dataset it is built from was `complete`; otherwise it is a **floor** ("at least"):

* **Totals.** Where the database reported a total it is shown as-is (the Daily Pulse "Evidence 1,500" is the database's count, not the 1,000 that loaded). Every other count that depends on a short dataset carries an explicit lower-bound flag and renders as `N+` with the visually-hidden words "or more" and a tooltip "At least N: not every record could be loaded" (`<Count>`).
* **Relationships.** An opportunity's documents are reached opportunity → `opportunity_signals` → signal → `signal_evidence` → evidence. A count is exact only if `opportunities`, `signals`, `evidence`, `opportunity_signals` and `signal_evidence` were **all** complete. If any is short, **every** opportunity's document count is a floor — including those whose own links did load, because no opportunity can tell which of its links is the one that is missing. This is deliberately conservative.
* **Coverage.** A coverage gap is a claim about absence. It is stated plainly only when `signals`, `signal_evidence`, `account_source_expectations` and `sources` were all complete; otherwise it is worded "was not seen for this account among the records that loaded, and those are incomplete, so this may overstate the gap", and the Source Health headline says coverage "may be overstated".
* **Absence.** "No such opportunity / company", "did not name a site", "has not produced a signal", "No evidence linked yet" are all hedged ("did not load", "among the records that loaded", "may still exist") when the underlying read was incomplete, and keep their original wording when it was whole.

Flags are **omitted when the figure is exact**, so a whole read produces the same objects as before this change.

## 5. Which surfaces warn

A non-alarming notice (`<IncompleteDataNotice>`, `role="status"`, the existing informational `notice--info` treatment, no new colour) renders **before the body, including on an otherwise empty page**: *"Not every record could be loaded. This page is showing part of what is stored."* — then the shortfalls in numbers, then a collapsible *"What this means for the figures"*, ending *"The stored records are unchanged; it is this view of them that is limited."* It renders nothing for `complete`, `limited` or absent completeness.

| Surface | Notice | Floors (`N+`) | Hedged absence |
|---|---|---|---|
| Daily Pulse | yes (also on the empty page) | headline counts that are not the DB total, per-opportunity document counts | coverage "may be overstated"; change feed "latest 25 only", or "could not be read" |
| Opportunities (list) | yes | document counts; "of N loaded opportunities · M stored" | — |
| Opportunity (deep link) | yes | document counts | "This opportunity did not load" vs "No such opportunity" |
| Company (list) | yes | companies, opportunities, signals | "among the records that loaded" |
| Company (detail) | yes | opportunities, signals | opportunities, signals and documents absences |
| Map | yes (also when empty) | project, account and unlocated counts | unlocated reason: "…may exist that is not shown here" |
| Source Health | yes (also when empty) | connector activity facts | "still below expected coverage… may be overstated" |

## 6. Request budget

No dataset gets an extra request: the count rides on the read that already existed. Totals per surface after this change: Opportunities 9, Company 9, Daily Pulse 10 (9 + the bounded change feed), Source Health 10 (9 + `source_runs`), Map 11 (9 + the two location reads). `source_runs` and the two location tables, which were previously unbounded by any count, now carry `count: 'exact'` and the same cap. Browser memory is bounded by `READ_LIMIT` per table, as before.

## 7. Tests

* `app/src/test/readTruncation.test.ts` (87 cases) runs the **real** `createApiDataSource` against a PostgREST-shaped fake (`readTruncation/fakeSupabase.ts`: it orders, applies a server `max_rows`, returns `count` only when asked and able, can omit/null/short/zero it, can error or reject a request, and **shuffles any unordered read on every call**). Covered: 999, exactly 1,000, 1,001 and 1,500 rows; the 1,500-row evidence case; each of the eight datasets one past the cap; truncated relationship tables and the parent-child damage they cause; coverage hedging; deterministic ordering (unique tails, newest-first with nulls last, ordered columns ⊆ selected columns, no withheld columns, repeated reads identical under shuffling, with a control proving the fake does shuffle); failure of every read, error-code classification and a rejected request; null, omitted, short and zero counts; a server cap below the client limit; and request counts.
* `app/src/test/incompleteNotice.test.tsx` (37 cases) renders the **real** pages and asserts the visible text: the notice on Pulse, Opportunities, Company (list, detail), Map and Source Health; floors rendered as "N+ … or more"; hedged absences; no notice and no floors when everything loaded; `role="status"` and no `alert`.
* `app/scripts/browser-layout-test.mjs` gained an `incomplete-notice` scenario (mounted by `app/src/test/browser/harness.tsx` inside the real shell and stylesheet) measured in Chromium at 360, 390, 768 and 1440 px: the notice stays inside the viewport, nothing in it overflows, the icon is at most 24 px, each shortfall has room to read, it is a polite `status` rather than an alert, and its disclosure opens without breaking the layout. jsdom has no layout engine, so this is the only place that can be asserted. (The same run shows the shell's mobile header sign-out button ending at 366 px at a 360 px viewport; that is outside this change and is not asserted here.)
* The R1.5 synthetic regression harness is untouched and still green.

## 8. Known scaling limitations

1. **It reports; it does not repair.** Past 1,000 rows of a table the page still shows only the loaded rows. Lists, "top" items and per-account figures are computed from them. The notice and the floors say so; they do not fetch the rest.
2. **Link-table truncation poisons every document count**, not only the unlucky ones (§4). A deployment past ~1,000 links shows `N+` everywhere on those pages until the links are read server-side.
3. **Keyed, not recency-ordered, link loss.** Truncated link tables drop links by key order, so which opportunities lose documents is deterministic but arbitrary.
4. **`count: 'exact'` costs a scan** on each of up to 11 queries per page. It is cheap at today's table sizes and is the first thing to revisit at 10⁶ rows (`planned`/`estimated` counts are not reliable enough to say "complete").
5. **`readFreshness` is not covered.** It reads enabled `sources` without a cap guard. It is a configuration table of tens of rows; the guarded `sources` read in `readGraph` is the one reported on.
6. **A page can be both degraded and incomplete.** They are shown as separate facts, not merged into one.
7. **The notice is page-level.** It lists which datasets are short; it does not mark individual rows.

## 9. Recommended next step: server-side views and pagination

Replace "load the tables, join in the browser" with **server-side read models**, in this order of value:

1. **A per-opportunity summary view** (`opportunity_id`, document count, source count, last evidence date) computed in Postgres, so a document count is a column and not a client-side join across two link tables. This removes the only reason link-table truncation matters.
2. **A per-account coverage view** (expected sources, observed sources, missing) so a coverage gap is a database fact, not an absence inferred from loaded rows.
3. **Keyset-paginated list endpoints** for opportunities, accounts, evidence and signals (`order by (sort_key, id)`; the cursor is the last pair), replacing `.limit(1000)` with pages the UI asks for. The unique tails added here are exactly the keyset the pages need.
4. **Totals as view columns** (or `count: 'exact'` on the paginated list), so the headline numbers stay exact.

These need views and grants (R2 territory, and every column the UI reads needs its own grant — doc 20 §4). They are **not** part of this change. When they land, this change's `completeness` envelope shrinks to the datasets still read in bulk, and eventually to nothing.

## 10. A defect found on the way (not fixed here)

> **Update, same day:** repaired in [doc 22](22_PULSE_CHANGE_FEED_REPAIR.md). The read now selects real columns; the market ledger it reads still has no writer, which doc 22 §3 and §8 state. The text below is kept as written when the defect was found.

The Daily Pulse change feed selects `change_kind, summary`, and `change_events` has neither (`db/migrations/0012`: the columns are `change_type`, `object_type`, `object_id`, `from_state`, `to_state`, `materiality`, …). The read therefore errors with `42703` against the real schema, and before this change that error was **swallowed**, so the feed was silently empty. It is now reported as a failed read, so Daily Pulse will show the notice "The recent changes could not be read" until the select is corrected. That correction needs a decision on what a change's summary text should be (the table has no such column), so it is left for a separate change rather than guessed at here.

## 11. What did not change

No migration; no RLS policy or column grant; no table or view; no connector or configuration; no production read or write; no authentication change; no new dependency; the R1.5 harness, docs 18 / 19 / 19a and every ADR are untouched.
