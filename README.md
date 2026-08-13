# Haskell Food & Beverage Opportunity Radar

Claude-ready platform design package

Version: 0.1  
Prepared: 2026-08-12

## Purpose

This package defines an automation-first opportunity intelligence platform for Haskell's Food & Beverage organization. It is intended to help Claude develop the product architecture, information architecture, user experience, source strategy, data model, and implementation roadmap before code is written.

The platform will aggregate public and licensed information, resolve it to companies and facilities, identify emergent signals, distinguish market trends from account-specific opportunities, and deliver concise daily intelligence without depending on analysts to enter leads or repair routine extraction failures.

## Recommended working name

**Haskell Food & Beverage Opportunity Radar**

The name is provisional. The product model matters more than the label.

## Package contents

| File | Purpose |
| --- | --- |
| `00_CLAUDE_MASTER_PROMPT.md` | Primary prompt to begin a design session with Claude |
| `01_PRODUCT_BRIEF.md` | Mission, users, scope, requirements, and product principles |
| `02_DATA_AND_SIGNAL_MODEL.md` | Entities, signal taxonomy, lifecycle, confidence, and scoring |
| `03_AUTOMATION_AND_SOURCE_ARCHITECTURE.md` | Collection hierarchy, extraction resilience, source health, and security |
| `04_UX_DESIGN_SPEC.md` | Navigation, page requirements, visual language, and interactions |
| `05_IMPLEMENTATION_ROADMAP.md` | Phases, acceptance criteria, backlog structure, and key decisions |
| `06_SOURCE_DATA_PROFILE.md` | Workbook structure, quality findings, and ingestion mapping |
| `schemas/platform.schema.json` | JSON Schema for the platform domain model |
| `schemas/database.sql` | PostgreSQL reference schema |
| `schemas/source-config.example.yaml` | Example source-registry configuration |
| `schemas/sample-opportunity.json` | Example evidence-backed opportunity record |

## Repository layout

The files above (`00`–`06` and `schemas/`) are the **design baseline**, unchanged from
package version 0.1. Work produced in response to the baseline lives under `docs/`:

| Path | Purpose |
| --- | --- |
| `docs/design/10_DESIGN_RESPONSE.md` | Design-phase response to `00_CLAUDE_MASTER_PROMPT.md`: product statement, conflict register, traceability matrix, architecture, information architecture, user journeys, data-model review, source strategy, reliability plan, backlog, open decisions, and the proposed approval sequence |
| `docs/design/11_SCHEMA_DELTA_PROPOSAL.sql` | Proposed v0.1.0 → v0.3.0 schema delta. A proposal for review, **not** a migration. Nothing has been applied |
| `docs/design/12_PILOT_SOURCE_COVERAGE_MATRIX.md` | Verified per-account source coverage for all 15 Highest Value accounts, with a confidence label on every cell |
| `docs/design/13_GATE_1_DECISION_PACKET.md` | Every open stakeholder decision with recommended default, alternatives, operational consequence, cost, owner, and required timing |
| `docs/design/14_EXTERNAL_RESEARCH_RECONCILIATION.md` | Disposition of every material external research finding, the research-claim staging contract, and the change register |
| `docs/adr/` | Architecture decision record. All entries are Proposed until ratified at a stakeholder gate |

The design response is at version 0.3.

- **v0.2** corrected two v0.1 findings — the characterization of the PACK EXPO event data,
  and an unverified SEC coverage count — and deepened the temporal model, evidence access
  modes, idempotency, runtime boundaries, and metrics design.
- **v0.3** reconciled external research (Gemini and Perplexity outputs). Every external
  claim was treated as untrusted input; no external record entered a canonical table.

Corrections are recorded in the documents rather than quietly rewritten.

## How to use this package with Claude

1. Attach the entire ZIP to a new or existing Claude project conversation.
2. Tell Claude to begin with `00_CLAUDE_MASTER_PROMPT.md`.
3. Require Claude to read every package file before proposing architecture or UI.
4. Keep design and implementation as separate approvals.
5. Do not permit Claude to redefine the opportunity lifecycle, source-health requirements, or entity model without explaining the impact.

## Source workbooks summarized

The platform concept was informed by:

- `Pack Expo - Initial Targeting Ideas.xlsx`
- `XPressLeads_PACK1025_2592134 (2).xls`

Key observations:

- 171 curated target rows representing approximately 170 normalized companies.
- 49 Tier 1, 69 Tier 2, and 53 Tier 3 account rows.
- 15 Highest Value accounts, all within the curated targeting universe.
- 519 populated PACK EXPO email-list rows representing 183 unique company strings.
- 397 XPressLeads records representing approximately 320 company strings.
- 58 XPress company names appear more than once.
- 341 XPress records are based in the United States.
- Only 10 curated targets have an exact normalized company match in the XPress export.
- Only 5 of the 15 Highest Value accounts have an exact normalized match in XPress.
- The event data mixes manufacturers, brands, suppliers, OEMs, distributors, universities, consultants, Haskell, and unrelated organizations.

These findings make entity resolution, role classification, and facility-level modeling foundational requirements.

## Authoritative Haskell context

- https://www.haskell.com/insights/food-beverage-industry-has-a-trusted-partner-in-haskell/
- https://www.haskell.com/market/food/
- https://www.haskell.com/market/food/snacks-baking/
- https://www.haskell.com/market/food/candy/
- https://www.haskell.com/market/food/pet-food-treats/
- https://www.haskell.com/market/food/protein-ready-to-eat/
- https://www.haskell.com/market/food/alternative-protein/
- https://www.haskell.com/market/food/coffee/
- https://www.haskell.com/market/food/agri-science/
- https://www.haskell.com/market/food/cold-storage-distribution/
- https://www.haskell.com/market/beverage/
- https://www.haskell.com/market/dairy/
- https://www.haskell.com/market/beer-wine-spirits/
- https://www.haskell.com/market/consumer-products/

## Non-negotiable requirements

- Routine operation cannot depend on analyst data entry.
- Collection failures cannot silently appear successful.
- Every opportunity must be supported by retrievable evidence.
- Market trends and company opportunities must remain separate objects.
- Account priority cannot substitute for project evidence.
- Company and facility identities must be modeled separately.
- The system must preserve source publication time and retrieval time separately.
- Missing dates must remain missing. The platform cannot invent dates.
- Collection should prioritize APIs, licensed feeds, validated feeds, and structured content.
- CAPTCHA bypass and unauthorized authenticated scraping are prohibited.
- Operator assistance may be used for permitted reauthorization or CAPTCHA completion without requiring content entry.
- The platform must expose source health, freshness, partial success, and action-required states.
- The interface should be clean, visual, fast, and simple enough for business-development users to process in minutes.
