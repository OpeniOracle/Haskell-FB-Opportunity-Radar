# Database migrations

The executable schema for the Radar. Everything here is **DDL only** — no
migration in this directory inserts, updates or deletes a row, and CI fails the
build if one starts to.

## Layout

```
db/
  migrate.mjs           the harness (dependency-free; shells out to psql)
  test.mjs              schema-contract tests, positive and negative
  verify.sh             the full contract, as CI runs it
  migrations/           NNNN_name.up.sql and NNNN_name.down.sql
  tests/fixtures.sql    structural fixtures, rolled back after every case
```

## Two forward paths

Both are required, and both are tested on every push.

| From | What happens to `0001` | Command |
| --- | --- | --- |
| An empty database | executed — it reproduces `schemas/database.sql` | `node db/migrate.mjs up` |
| A database already carrying v0.1.0 | **stamped**, not executed | `node db/migrate.mjs up --from-baseline` |

Stamping records the migration as applied without running it, because the schema
it would create is already there. Rolling a stamped migration back **unstamps**
it rather than dropping a schema this harness did not create.

`0001` includes `schemas/database.sql` with `\ir` rather than copying it, so
there is exactly one definition of the v0.1.0 baseline. That file is the design
baseline and is not edited by migrations.

## Commands

```bash
export PGHOST=… PGPORT=… PGUSER=… PGDATABASE=…

node db/migrate.mjs status                 # what is applied, what is pending
node db/migrate.mjs up                     # apply everything outstanding
node db/migrate.mjs up --to 0007           # apply up to and including 0007
node db/migrate.mjs up --from-baseline     # stamp 0001, apply the rest
node db/migrate.mjs down --to 0004         # revert back down to 0004
node db/migrate.mjs verify                 # checksums of applied migrations
node db/test.mjs                           # schema-contract tests
node db/test.mjs ownership                 # one group of them

bash db/verify.sh                          # everything CI runs
```

## Checksums

Every applied migration's checksum is recorded in `schema_migrations`, and every
run verifies it. **Editing a migration that has already been applied fails the
build.** Whitespace and blank lines are normalised first, so reformatting is not
a false alarm while a semantic edit is. If a migration is wrong, write another
one.

## Adding a migration

1. Create `NNNN_short_name.up.sql` **and** `NNNN_short_name.down.sql`. The
   harness refuses to revert a migration that has no down file.
2. Land constraints **with** their tables. A nullable column added "for now"
   becomes permanent.
3. Add contract tests to `db/test.mjs` — at least one case that must be
   rejected, asserting the **constraint name**, and one that must be accepted. A
   negative case that passes because of an unrelated typo is not a test.
4. Run `bash db/verify.sh`. It checks both forward paths, both rollbacks, the
   contract tests, and that a tampered migration is detected.

## What the down path guarantees

Rolling back to the baseline reproduces `schemas/database.sql` **dump for dump**,
which is stricter than "it ran without error". Two consequences worth knowing:

- A down migration must drop the indexes, comments and constraints its up
  migration added, not just the columns. A leftover comment fails the diff.
- Where a baseline constraint was anonymous, the down migration re-adds it
  anonymously so PostgreSQL regenerates the same name.

## Where the design lives

| Question | File |
| --- | --- |
| Why these tables and this order | `docs/design/15_PHASE_1_IMPLEMENTATION_PLAN.md` §7 |
| The proposed delta and its conflict-register citations | `docs/design/11_SCHEMA_DELTA_PROPOSAL.sql` |
| Temporal model | `docs/adr/0004` |
| Ownership intervals | `docs/adr/0005` |
| Ontology and scoring as configuration | `docs/adr/0008` |
| Research-claim staging and the activation gate | `docs/adr/0011` |
| Corrections supersede rather than overwrite | `docs/adr/0012` |
| Hosting and tenancy | `docs/adr/0013`, `docs/design/17_ARCHITECTURE_HOSTING_RECONCILIATION.md` |
