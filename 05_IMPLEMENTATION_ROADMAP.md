# Implementation Roadmap

## Delivery strategy

Build the shared intelligence foundation and Food & Beverage product incrementally. Begin with a small high-value account cohort and a narrow group of reliable sources. Expand only after connector health, entity resolution, evidence quality, and user relevance meet defined thresholds.

## Phase 0: Discovery and design confirmation

Estimated duration: 2 weeks

### Objectives

- Confirm users, workflows, outputs, and decision cadence.
- Validate the target-account and event data.
- Confirm existing Haskell Hub components available for reuse.
- Establish the architecture decision record.
- Approve pilot sources and licensing assumptions.
- Approve visual direction and page map.

### Deliverables

- Requirements traceability matrix
- User journeys
- Information architecture
- Source inventory and source contracts
- Data-model review
- Security and licensing assumptions
- Low-fidelity wireframes
- Pilot acceptance plan

### Exit criteria

- Stakeholders approve the pilot cohort.
- Stakeholders approve opportunity stages and scoring dimensions.
- Stakeholders approve the source collection policy.
- Material unresolved decisions have owners and deadlines.

## Phase 1: Identity and evidence foundation

Estimated duration: 3 to 4 weeks

### Scope

- Import all curated target accounts.
- Identify the 15 Highest Value and 49 Tier 1 accounts.
- Import PACK EXPO event and email-list data as engagement evidence.
- Normalize aliases and obvious parent relationships.
- Establish organization and facility records.
- Implement source registry, source runs, evidence storage, and audit events.
- Implement content hashing and idempotent ingestion.

### Exit criteria

- Source workbooks load without duplicate target accounts.
- Every imported row retains source provenance.
- Parent, subsidiary, brand, and facility relationships are inspectable.
- Reprocessing produces no duplicate evidence records.
- Ambiguous company mappings remain unresolved instead of being guessed.

## Phase 2: Pilot collection and processing

Estimated duration: 4 to 6 weeks

### Pilot cohort

The 15 Highest Value accounts:

- PepsiCo
- The Coca-Cola Company
- Nestlé
- Kroger
- Tyson Foods
- Mars
- The Hershey Company
- Kimberly-Clark
- Unilever
- Procter & Gamble
- Sherwin-Williams
- Ecolab
- Danone
- Keurig Dr Pepper
- Niagara Bottling

### Source scope

- SEC EDGAR
- Company newsroom and investor-relations sources
- GDELT or approved broad-news feed
- FDA food enforcement
- USDA FSIS
- EPA ECHO
- A small set of selected local or state sources

### Processing scope

- Extraction and evidence locators
- Organization and facility resolution
- Signal classification
- Duplicate clustering
- Opportunity promotion rules
- Trend clustering
- Score calculation
- Daily briefing generation
- Source-health monitoring

### Exit criteria

- At least 95% of scheduled connector runs complete successfully over a 14-day test window.
- Every displayed opportunity has retrievable supporting evidence.
- No routine manual lead entry is required.
- Source failures appear within one scheduled cycle.
- A repeated run against unchanged evidence produces no duplicate alerts.
- Users can review the daily queue in under ten minutes.

## Phase 3: MVP interface

Estimated duration: 4 to 6 weeks, overlapping Phase 2 where practical

### Scope

- Pulse
- Opportunities
- Opportunity detail
- Accounts and account detail
- Facility detail
- Market Trends
- Map
- Briefings
- Alerts and saved views
- Source Health and Connector Care

### Exit criteria

- Primary user journeys pass usability testing.
- Score explanations are visible and understandable.
- Trend and opportunity objects are visually distinct.
- Coverage and freshness limitations are visible.
- Desktop and mobile review workflows function.
- Accessibility review identifies no critical blockers.

## Phase 4: Tier 1 expansion

Estimated duration: 4 to 6 weeks

### Scope

- Expand monitoring to all 49 Tier 1 accounts.
- Add selected state economic-development and incentive sources.
- Add reliable planning and permitting connectors for priority geographies.
- Add relationship and CRM links.
- Tune organization-role classification.
- Add user feedback analytics.

### Exit criteria

- Coverage expansion does not reduce connector success below target.
- Duplicate opportunity clusters remain below 10% of presented opportunities.
- Account and facility resolution meets the approved accuracy threshold.
- Dismissal reasons show declining false-positive categories.

## Phase 5: Full curated universe and discovery

Estimated duration: 6 to 8 weeks

### Scope

- Expand monitoring to Tier 2 and Tier 3 accounts.
- Qualify PACK EXPO companies outside the curated list.
- Discover new companies and facilities from high-confidence sources.
- Add competitive and geographic analysis.
- Add automated weekly and monthly executive reporting.
- Add reusable market-module configuration for other Haskell departments.

## Initial product backlog

### Epic: Account foundation

- Import target workbooks.
- Normalize company names.
- Preserve original company strings.
- Create aliases.
- Assign target tiers.
- Mark Highest Value accounts.
- Classify organization roles.
- Represent parent and subsidiary relationships.
- Record PACK EXPO engagement.

### Epic: Facility foundation

- Create facility entity.
- Resolve addresses and coordinates.
- Link regulatory identifiers.
- Track facility operating status.
- Track products, processes, and facility types.

### Epic: Source operations

- Create source registry.
- Schedule source runs.
- Enforce allowed domains.
- Track retries and partial success.
- Record health metrics.
- Create Connector Care tasks.

### Epic: Evidence pipeline

- Archive original content.
- Hash and deduplicate evidence.
- Extract HTML and structured data.
- Extract PDFs.
- Run OCR when required.
- Store excerpts and locators.
- Preserve timestamps.

### Epic: Intelligence processing

- Resolve organizations and facilities.
- Classify signals.
- Align Haskell capabilities.
- Cluster duplicates and related signals.
- Promote opportunities.
- Cluster market trends.
- Compute scores and explanations.

### Epic: Experience

- Build Pulse.
- Build opportunity queue and detail.
- Build account and facility views.
- Build trends and map.
- Build briefings and alerts.
- Build Source Health.

## Acceptance metrics

### Automation

- Scheduled-run success rate
- Source freshness compliance
- Percentage of collection requiring operator action
- Median recovery time
- Duplicate evidence rate
- Duplicate alert rate

### Intelligence quality

- Organization-resolution accuracy
- Facility-resolution accuracy
- Signal-classification precision
- Opportunity dismissal rate
- Promotion accuracy
- Evidence-link availability
- Undated evidence handled without fabricated dates

### User value

- Daily review time
- Pursue and Watch actions
- Opportunities assigned
- Briefing open rate
- Saved-view usage
- User-rated relevance
- Opportunities connected to account planning

## Decisions required before implementation

1. Will the platform be deployed inside the existing Haskell Hub or as a separate application sharing backend services?
2. Which identity, hosting, database, queue, search, storage, and model services are already approved?
3. Which CRM should receive or link pursued opportunities?
4. Should immediate alerts use Microsoft Teams, email, or both?
5. Which geographies receive local permitting and incentive coverage first?
6. Which paid news or market-data subscriptions are available?
7. What retention and display rights apply to licensed content?
8. Who owns account-tier changes and manual opportunity overrides?
9. What constitutes a successful business-development outcome for pilot evaluation?
10. Which Haskell design system or brand assets should govern the interface?

## Recommended stakeholder approval sequence

1. Product mission and users
2. Opportunity definition and scoring
3. Pilot accounts and source coverage
4. Security, licensing, and connector policy
5. Information architecture and visual direction
6. Data schema and service boundaries
7. MVP backlog and acceptance criteria
8. Implementation authorization

