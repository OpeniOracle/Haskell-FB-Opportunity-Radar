# Data and Signal Model

## Conceptual hierarchy

```text
Organization
  -> Brand or subsidiary
  -> Facility
  -> Evidence
  -> Signal
  -> Opportunity

Evidence from many organizations and facilities
  -> Market trend
```

## Core entities

### Organization

A legal entity, brand, operating company, distributor, supplier, OEM, retailer, competitor, consultant, government body, or academic institution.

Required concepts:

- Canonical name
- Aliases and prior names
- Organization role
- Parent organization
- Brands and subsidiaries
- Market sectors
- Target tier
- Highest Value flag
- Public identifiers such as SEC CIK
- Headquarters
- Engagement evidence

### Facility

A physical or proposed manufacturing, processing, packaging, cold-storage, warehouse, distribution, office, laboratory, or mixed-use site.

Required concepts:

- Owning or operating organization
- Facility name and aliases
- Facility type
- Address and coordinates
- Operating status
- External regulatory identifiers
- Products and processes
- Known Haskell-relevant capabilities
- Opening, closure, or expansion dates when supported

### Source

A configured origin from which documents or structured records are collected.

Required concepts:

- Source owner and type
- Collection method
- Base URL and allowed domains
- Schedule and freshness SLA
- Authentication mode
- Terms or licensing review status
- Extraction configuration
- Health status
- Operator-intervention policy

### Source run

One execution of a configured source connector.

Statuses:

- `queued`
- `running`
- `success`
- `partial_success`
- `unchanged`
- `failed`
- `action_required`

### Evidence

The preserved primary or secondary record from which a fact or assessment is derived.

Required concepts:

- Source
- Original and resolved URLs
- Title
- Published time
- Retrieved time
- Event date when explicitly stated
- Content hash
- MIME type
- Raw-storage reference
- Extracted text
- Evidence excerpt and locator
- Extraction method and version
- Licensing or display restrictions

### Signal

A normalized event or observation extracted from evidence and associated with an organization, facility, geography, or market.

Examples:

- Company announces a new facility.
- Planning commission reviews a proposed production site.
- Company reports packaging-line investment.
- Recall affects a named plant.
- Company hires a vice president of engineering for a new network.
- Utility permit indicates increased industrial demand.

### Opportunity

An evidence-backed assessment that a company or facility may require one or more Haskell capabilities within a plausible planning or execution horizon.

An opportunity requires:

- At least one supporting signal
- Organization association
- Facility association where known
- Haskell capability alignment
- Opportunity stage
- Timing or horizon assessment
- Confidence assessment
- Explanation of why it matters

### Market trend

A repeated or accelerating pattern across multiple signals, organizations, facilities, or sources.

A trend is not an opportunity. It can inform sector strategy, account monitoring, and query expansion.

## Organization roles

- `manufacturer_brand`
- `parent_company`
- `subsidiary_division`
- `co_manufacturer_private_label`
- `retailer`
- `distributor_logistics`
- `ingredient_supplier`
- `packaging_supplier`
- `equipment_oem`
- `engineering_contractor_consultant`
- `competitor`
- `investor_lender`
- `government_regulator`
- `economic_development`
- `academic_research`
- `media_trade_publication`
- `other`
- `unknown`

## Signal families

### Facility and capacity

- New facility
- Plant expansion
- Capacity increase
- Site selection
- Land acquisition
- Facility modernization
- Brownfield conversion
- Closure, idling, or consolidation

### Process systems

- New processing technology
- Mixing, grinding, extrusion, drying, fermentation, pasteurization, or aseptic investment
- CIP or SIP modernization
- Ingredient-receiving or bulk-handling changes
- Process relocation

### Packaging systems

- New packaging line
- Format conversion
- Bottling, canning, filling, cartoning, pouching, or case-packing investment
- Labeling or coding change
- Sustainable-material conversion
- New SKU requiring line flexibility

### Automation and controls

- Robotics
- Controls modernization
- PLC, HMI, or SCADA upgrades
- ASRS
- Automated material handling
- Digital twin or simulation
- OEE improvement
- Labor-reduction investment

### Food safety and compliance

- Recall
- Warning or enforcement action
- Allergen segregation need
- Hygienic zoning
- Sanitation or cleanability issue
- Foreign-material control
- Regulatory modernization

### Utilities and sustainability

- Refrigeration modernization
- Water reuse or wastewater treatment
- Steam, compressed air, or utility expansion
- Energy-efficiency program
- Decarbonization
- Emissions or discharge permit
- Waste reduction

### Distribution and supply chain

- Cold-storage expansion
- New distribution center
- Warehouse automation
- Network redesign
- Reshoring
- Logistics consolidation

### Corporate and capital

- Capital-expenditure guidance
- Funding round
- Acquisition or divestiture
- Strategic partnership
- Executive or engineering leadership change
- Facility-related job growth
- Incentive award
- Procurement or OEM selection

### Market and demand

- New product category
- Consumer-demand shift
- Commodity or ingredient constraint
- Regulatory change
- Regional growth
- Technology adoption

## Opportunity stages

### Emerging

One credible leading signal suggests a possible project or need. Typical horizon: 12 to 36 months.

Examples:

- Site search
- Early capital guidance
- Engineering leadership hiring
- Capacity constraint discussed without a project announcement

### Developing

Multiple independent signals or one strong authoritative signal indicate planning, funding, or project formation. Typical horizon: 6 to 24 months.

Examples:

- Incentive application plus land acquisition
- Announced expansion with preliminary scope
- Permit activity connected to a target facility
- Public capex allocation for a named network or plant

### Confirmed

An authoritative source confirms a defined project, procurement, permitting action, design effort, construction program, or equipment investment. Typical horizon: 0 to 18 months.

Examples:

- Official facility announcement
- Approved permit or planning case
- Construction start
- RFP or equipment procurement
- Named capital project in a filing or earnings release

## Opportunity status

- `new`
- `watching`
- `pursue`
- `assigned`
- `on_hold`
- `dismissed`
- `closed_won`
- `closed_lost`
- `cancelled`
- `expired`

## Confidence

### Possible

Evidence is credible but incomplete, indirect, or based on a single non-authoritative source.

### Probable

Evidence is corroborated by independent reporting, consistent structured data, or a strong primary-source indication.

### Confirmed

An authoritative primary source explicitly establishes the event or project.

## Scoring dimensions

Keep dimensions visible. Store both component scores and the computed result.

| Dimension | Range | Meaning |
| --- | ---: | --- |
| Haskell fit | 0 to 30 | Alignment with Haskell capabilities and sectors |
| Project maturity | 0 to 25 | Strength of planning, funding, permitting, procurement, or execution evidence |
| Potential scope | 0 to 20 | Plausible breadth of facility, process, packaging, automation, or utility work |
| Timing and momentum | 0 to 15 | Recency, acceleration, and actionable horizon |
| Account strategy | 0 to 10 | Tier, Highest Value status, engagement, and relationship relevance |

Raw pursuit score:

```text
haskell_fit + project_maturity + potential_scope + timing_momentum + account_strategy
```

Confidence multiplier:

| Confidence | Multiplier |
| --- | ---: |
| Possible | 0.60 |
| Probable | 0.80 |
| Confirmed | 1.00 |

Final pursuit score:

```text
round(raw_pursuit_score * confidence_multiplier)
```

Account strategy is intentionally limited to ten points. Tier 1 status cannot turn weak project evidence into a high-readiness opportunity.

## Corroboration rules

- Count independent organizations, not the number of articles repeating the same release.
- Syndicated copies of one article count as one evidence family.
- A primary company announcement can independently support Confirmed confidence.
- A government permit, approved incentive, regulatory filing, or official procurement record can independently support Confirmed confidence.
- Model-generated summaries never count as independent corroboration.
- PACK EXPO activity increases account relevance but does not independently increase project maturity.

## Promotion rules

- Evidence creates or updates signals.
- Signals may create an Emerging opportunity when company or facility relevance and Haskell fit exceed defined thresholds.
- Opportunities move to Developing through corroboration, authoritative planning evidence, or repeated momentum.
- Opportunities move to Confirmed through explicit authoritative project evidence.
- Negative signals can reduce momentum, move an opportunity on hold, or close it.
- Manual overrides require a reason and preserve the computed assessment.

## Deduplication and clustering

Deduplication should consider:

- Canonical URL
- Content hash
- Syndication origin
- Organization and facility
- Event type
- Location
- Event date
- Project name
- Monetary amount
- Semantic similarity

The system should retain every evidence record while presenting one consolidated signal or opportunity timeline.

