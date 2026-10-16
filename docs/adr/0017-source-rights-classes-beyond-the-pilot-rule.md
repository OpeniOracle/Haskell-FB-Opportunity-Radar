# ADR 0017 — Source rights classes beyond the pilot rule

**Status:** **Proposed.** Not accepted; awaiting separate review.
**Date:** 2026-10-16
**Supersedes:** nothing. **Extends:** ADR 0014 (accepted for the pilot). **Relates to:** ADR 0006
(Proposed), ADR 0009 (Proposed), decision D-R2 (`docs/design/20`), migration 0026.

*This record is an engineering policy, not legal advice. It decides a default and names the
act that moves a source off it. Whether a particular body's material may be retained or
reused is a question for the owner and counsel, and nothing here answers it for any state,
county or municipality.*

## Context

ADR 0014 decides two kinds of material for the pilot: **U.S. government works** are
`archived_full_text`, and **corporate newsroom and investor-relations material** is
`reference_only`. It says nothing about the rest of what the research package turned up, and
the rest is large. By host, of the 130 research units: 30 rest on **state or local public
bodies and authorities** (governors' offices, a state economic-development department, a
county industrial development agency, a state environmental agency, a municipality), 5 on
**economic-development non-profits and advocacy sites**, and 6 on **discovery or
republication** (wire services and indexes). None of those is a federal work, and none is a
company's own page.

They cannot be treated as federal by resemblance. A `.gov` host is not a federal work: state
public-records laws govern *access* and say little about *reuse*, municipal publications and
meeting packets may carry their own copyright or terms, and an economic-development
organisation's site is copyrighted by that organisation. A source can be public, free to read
and still not ours to copy.

The code already fails in the safe direction. A source whose rights are unrecognised is held
by reference: `sources.access_mode` defaults to `reference_only`, the evidence pipeline
honours the registry's mode (roadmap R1), and the schema refuses a reference-only row that
carries a body. What is **missing is the record of what kind of publisher a source is**, and a
stated rule that connects that to the right to archive. Without them the posture is a
default that nothing explains and that one careless seed could change.

## Decision (proposed)

**1. Every source records what kind of publisher it is**, in `sources.rights_class`:

| Class | Meaning |
|---|---|
| `federal_public_record` | U.S. federal government work (SEC, FSIS, EPA). The only class ADR 0014 lets be archived |
| `state_local_public_record` | A state or local public body or authority, including municipal publications |
| `economic_development_body` | An economic-development organisation |
| `corporate_first_party` | A company's own newsroom or investor-relations pages (ADR 0014) |
| `discovery_or_republication` | Press, wire services, indexes, aggregators and advocacy sites. **A copy is not an origin** |
| `unclassified` | Nothing is asserted. **The default** |

**2. Federal public records are unchanged.** ADR 0014 stands as written for them.

**3. Everything else is `reference_only` until its rights are established.** The Radar keeps
what ADR 0014 lists for reference-only material: the URL, title, publisher, the publication
date *when the source states one*, the retrieval time, the content hash, the structured
extracted claims and the minimum supporting excerpt, and not the page body.

**4. "Established" is a recorded declaration, not an inference.** A source that is not a
federal public record may be archived, parsed as an official record, or held as licensed full
text only if it has **declared `license_mode` `open` or `licensed`**, with
`terms_reviewed_at` and `license_notes` recording the determination and who made it. The
default, `unknown`, does not qualify, and neither does `restricted`.

**5. Nothing is reclassified by resemblance.** Not by the host's top-level domain, not by
being publicly readable, not by being the nearest thing to a federal record. Moving a source
to `federal_public_record` is a reviewed change to the registry, and a source is never
*silently* made federal.

**6. The rule is enforced in the schema, not remembered.** Migration 0026 adds one
constraint, `sources_archive_requires_established_rights`: a source is either a federal public
record, or reference-only or metadata-only, or has declared an open or licensed posture. A
seed, a script or a hurried correction cannot put an unclassified, state, municipal or
corporate source into full-text archiving, because the row is refused.

**7. The class follows the publisher of the bytes retrieved.** An SEC filing hosted on an
issuer's investor-relations vendor page is not on EDGAR; it is classified by who served it, or
re-pointed to the EDGAR accession before it is treated as federal material.

**8. Discovery and republication is never an origin.** A republished copy joins the evidence
family of the origin it copies (ADR 0006 rule 4; `evidence_families`), so breadth of discovery
cannot inflate corroboration.

## What this does not decide

- **Which source is open or licensed.** That is a determination per source, by the owner with
  counsel, recorded in `license_mode`. This ADR sets the default and the act; it does not
  perform the act for any state.
- **D16 and D17** stay Open. **ADR 0006** stays Proposed: this extends the pilot rule
  (0014), as 0014 itself did.
- **Retention.** `retention_days` and `retention_expires_at` continue to govern how long
  anything is kept; this changes none of it.
- **What the classifier does with reference-only evidence.** ADR 0014 and ADR 0006 rule 1
  already cap it; nothing here changes the cap.

## Consequences

**Good.** A state or municipal record cannot be archived by accident. The posture for the
sources the roadmap is about to add (state incentives, local planning) is decided and
visible before the first connector is written, not argued after the first byte is stored. The
class is queryable, so "which of our sources have we not classified" is a query.

**Bad, and accepted.** For these sources the Radar will hold an excerpt and extracted claims,
not the document, until someone establishes the rights. A permit or a board resolution is often
exactly the primary record a reviewer wants to re-read. The remedy is the one the decision
names: establish the rights for that source and record the declaration. The schema makes the
slow path safe and the fast path explicit.

The coupling is coarse on purpose. It does not distinguish a state with a clear reuse licence
from a county with none; both wait for a declaration. Refining it per source class would mean
encoding legal conclusions in a constraint, which is exactly the thing this ADR avoids.

## Alternatives considered

- **Treat every government host as a public record.** Rejected: it confuses access with reuse
  and quietly makes a legal determination, for every state at once, in a regular expression.
- **Decide per document.** Rejected for now: the right unit of a rights determination is the
  publisher, and per-document rights make every ingestion a legal review.
- **Keep reference-only for these sources with no recorded class.** Rejected: that is today's
  behaviour, and it works only until someone seeds a source in good faith with a different
  mode. The class and the constraint turn a habit into a rule.
- **Encode a per-class access mode directly** (`state_local` always reference-only, with no
  way out). Rejected: it would require a migration to act on a rights determination that is
  made by a person, and the determination, not the schema, is what changes.

## Revisit when

Counsel establishes the reuse and retention position for a class of source, a state publishes a
clear reuse licence for its records, or a source on the roadmap needs full text to be useful
and its rights can be established.
