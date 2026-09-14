# Spyglass → Radar: the CSV ingestion boundary

**Status: specified, not built.** This document exists so the boundary is a
decision on the record rather than an assumption somebody makes later.

## The boundary

An embedded Zignal widget is a **picture of a chart**. The Radar holds no rows
behind it, cannot cite it, cannot date it beyond the snapshot timestamp, and
must never derive an opportunity from it.

That is not a limitation of this implementation — it is what the embed *is*.
Zignal's own documentation states that embeddable widgets support neither
realtime nor data refresh: an embed shows the data that existed when the snippet
was generated, permanently. There is no row, no identifier, and no way to ask it
a question.

So the rule is: **Spyglass is context, not evidence.** The Media Intelligence
surface says so on the page, because the assumption is an easy one to make and
expensive to unwind once a pursuit has been justified on it.

## What a future import must preserve

Media coverage reaches the Radar as evidence only through a reviewed CSV export
from Zignal's existing reporting workflow. When that is built, an import record
must carry all of the following. Each one is here because an import that loses it
cannot be audited, and an intelligence record that cannot be audited is worth
less than no record:

| Field | Why it is required |
|---|---|
| Original filename | What the analyst actually exported and can be asked about |
| Dashboard or query name | *Which question* the rows answer. Two exports from one dashboard with different queries are different datasets |
| Export timestamp | When Zignal froze the data — the analogue of `snapshot_generated_at` |
| Import timestamp | When the Radar received it. Distinct from the export time, always |
| Imported by | A person, named. An import with no author cannot be queried |
| Row count | The check that the file that arrived is the file that was sent |
| File hash | Content identity, so a re-import is recognisable as one and a silently edited file is not |
| Analysis or report association | What the rows were used for. Without it, provenance stops at the file |
| Provenance | The chain from Zignal query to stored row, readable end to end |
| Deletion status | Retraction without destruction. Nothing is overwritten; a withdrawn import stays visible as withdrawn |

These mirror the guarantees the SEC connector already provides for filings
(`source_document_id`, `content_hash`, `retrieved_at`, `first_seen_at`,
`superseded_at`), and they exist for the same reason: an intelligence platform
whose records cannot be traced back to what was actually retrieved is a platform
that cannot be trusted about anything it says.

## What must not be built

**No automatic Spyglass-to-opportunity conversion.** Not from an embed, and not
from an unreviewed CSV. A mention is not a project: media coverage reports that
something was *said*, and the Radar's entire claim is that it reports what a
primary source *stated*. Collapsing the two would put "a trade publication
speculated about an expansion" in the same column, with the same confidence, as
"the company filed an 8-K describing one" — and after that nobody can tell them
apart.
