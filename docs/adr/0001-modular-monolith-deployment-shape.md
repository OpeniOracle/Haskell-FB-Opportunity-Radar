# ADR 0001 — Modular monolith over microservices for the pilot

**Status: Accepted** · **Approved via:** D1 (separate application sharing identity and
infrastructure) and D2a (platform architecture). The vendor selections behind it — **D2b**,
covering AI provider, identity provider, PostgreSQL hosting, and object storage — **remain
open and are IT's to make**. · **Relates to:** D1, D2a, D2b

## Context

`03_AUTOMATION_AND_SOURCE_ARCHITECTURE.md` §Deployment recommendation lists ten
independent services or bounded modules. Read as ten deployables, that implies a
service mesh, ten pipelines, and ten on-call surfaces.

Two facts constrain the choice. First, `00` states there is no dedicated analyst team,
and no package file names a dedicated platform team either. Second, the pilot is 15
accounts across roughly 8 source families — on the order of hundreds to a few thousand
documents per day. That is three to four orders of magnitude below the volume at which
independently scaled services and a message broker earn their operational cost.

## Decision

Build a **modular monolith with three isolated runtimes**:

- **Runtime A** — web app and API.
- **Runtime B** — worker pool (scheduler, connectors, extraction, resolution,
  classification, scoring, notification). No inbound network.
- **Runtime C** — egress gateway and browser sandbox (see ADR 0002).

The ten modules from `03` are preserved as **enforced boundaries inside Runtime B**:
separate database schemas, no cross-module table reads, interaction only through typed
interfaces and outbox events. PostgreSQL is both system of record and job queue;
object storage holds raw evidence.

The A/B split is for blast radius and deploy independence. The C split is a security
boundary and is not negotiable on volume grounds.

Runtime B is internally partitioned into **queue classes** — `collect`, `extract`,
`resolve`, `classify`, `score`, `notify`, `maintain` — each with its own concurrency
limit, so one saturated stage cannot starve the others. The governing rule for
transactions is one sentence: **a database transaction never spans a network call, and a
job is never enqueued outside the transaction that produced its cause.** Delivery from
the transactional outbox is at-least-once, so every consumer is idempotent on a natural
key. Full responsibilities, queue and transaction boundaries, outbox behavior, failure
isolation, and the gateway's five collection profiles are specified in
`docs/design/10_DESIGN_RESPONSE.md` §4.4–4.6.

## Alternatives considered

- **Ten deployed services now.** Rejected: correct boundaries, wrong time. The
  boundaries are what matter, and they are preserved without the deployment cost.
- **Single process, no module enforcement.** Rejected: without schema separation and
  interface discipline, the reusable-kernel goal (G11) quietly dies in month three.
- **External broker (Kafka/SQS) from day one.** Rejected: a transactional outbox in
  Postgres gives exactly-once-enough semantics at this volume, and removes the
  "row committed but job never enqueued" failure class entirely.

## Consequences

Good: one deploy pipeline, one set of migrations, local reproduction of the whole
pipeline, and cheap refactoring while the domain model is still moving.

Bad: a runaway worker can affect other workers in the same runtime; module boundaries
depend on discipline plus CI checks rather than on the network; and extracting a module
later is real work even if it is bounded work.

## Revisit when

Sustained throughput exceeds roughly 50 documents per second, a single module needs
independent scaling for more than a week, or a second Haskell market goes live with a
materially different cadence.
