# Source Data Profile

## Purpose

This document describes the two PACK EXPO workbooks used to inform the platform design. It identifies which fields can seed platform entities, which fields represent engagement or declared interest, and which fields require enrichment before they can support an opportunity.

## Workbook 1: Pack Expo - Initial Targeting Ideas.xlsx

### Sheets

| Sheet | Populated company rows | Purpose |
| --- | ---: | --- |
| Reference for Tiers | Reference text | Defines target-tier intent |
| Food | 53 | Curated food accounts |
| Beverage & Dairy | 44 | Curated beverage and dairy accounts |
| Beer Wine & Spirits | 36 | Curated alcohol accounts |
| Consumer Products | 38 | Curated consumer-product accounts |
| Highest Value | 15 | Priority pilot cohort |
| Pack Expo 2025 Email List | 519 populated rows, 183 unique company strings | Event-marketing audience and engagement universe |

### Tier definitions

#### Tier 1: High Engagement + Repeat Targeting

Accounts explicitly targeted in multiple 2024 and 2025 campaigns that demonstrated measurable engagement such as clicks, video views, or completions. These are the strongest combination of marketing focus and observed interest.

#### Tier 2: Strategic Targets

Accounts consistently included in campaign targeting by market or division with limited or moderate engagement. These are validated prospects for active nurture and secondary outreach.

#### Tier 3: Secondary / Extended Targets

Accounts appearing in broader campaign targeting lists with little or no measurable engagement. These are expansion candidates for monitoring and future pipeline development.

### Curated target counts

| Segment | Tier 1 | Tier 2 | Tier 3 | Total |
| --- | ---: | ---: | ---: | ---: |
| Food | 15 | 20 | 18 | 53 |
| Beverage & Dairy | 12 | 17 | 15 | 44 |
| Beer Wine & Spirits | 10 | 16 | 10 | 36 |
| Consumer Products | 12 | 16 | 10 | 38 |
| Total | 49 | 69 | 53 | 171 |

The 171 rows represent approximately 170 normalized companies because Nestlé appears in both Food and Beverage & Dairy with different descriptive naming.

### Highest Value pilot cohort

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

### Ingestion interpretation

| Workbook field | Platform use | Important limitation |
| --- | --- | --- |
| Company Name | Organization candidate | Must resolve parent, subsidiary, brand, and aliases |
| Segment sheet | Sector assignment | Some organizations span multiple sectors |
| Tier | Account priority | Does not establish project readiness |
| Highest Value membership | Pilot and alert priority | Does not establish current opportunity evidence |
| Email-list company | Engagement evidence and discovery candidate | Repeated rows and inconsistent names require normalization |

## Workbook 2: XPressLeads_PACK1025_2592134 (2).xls

### Shape

- 397 records
- 18 columns
- Approximately 320 distinct company strings
- 58 company strings appear more than once
- 341 records list the United States
- 17 records list Mexico
- 15 records list Canada
- Remaining records span 14 additional countries or have missing country data

### Geographic concentration within U.S. records

The most common states include California, Texas, Ohio, Georgia, New Jersey, Florida, New York, Utah, Missouri, Wisconsin, Pennsylvania, North Carolina, Iowa, Nevada, and Illinois.

### Fields

#### Event metadata

- `UserAccount`
- `TerminalID`
- `DeviceLabel`

`UserAccount` and `DeviceLabel` are empty in the supplied export. `TerminalID` contains two manual-import identifiers and should be retained as provenance, not treated as a person or device entity.

#### Organization and address

- `Company`
- `Address 1`
- `Address 2`
- `City`
- `State/Province`
- `Zip Code`
- `Country`

The address may represent a contact address, headquarters, office, vendor location, or plant. It is a facility candidate only. It must not be presented as a manufacturing facility until corroborated.

#### Declared event interests

- Products packaged and/or industries
- Agent or distributor response
- Contract manufacturing, packaging, or private-label response
- Packaging materials investigated
- Processing machinery investigated
- Packaging processes operating at the respondent's plant location
- Primary industry or product
- Packaging machinery technologies investigated

These fields describe self-reported PACK EXPO interests. They are useful for account segmentation, capability affinity, and search-term expansion. They do not prove a planned purchase or active capital project.

### Profile observations

- 143 records identify as Food/Beverage Manufacturer.
- 59 identify as Other packaged products.
- 24 identify as Life Sciences/Pharma/Healthcare.
- 41 answer Yes to the agent or distributor question.
- Most agent or distributor values are blank or No Response.
- Common declared technology interests include labeling, robotics, palletizing, material handling, case or tray packing, bag or pouch filling, conveying, filling or capping, vertical form-fill-seal, cartoning, inspection, coding, and bulk handling.
- Common processing interests include food-processing equipment, liquid processing and handling, and dry processing or ingredient handling.
- The dataset includes manufacturers, suppliers, OEMs, distributors, academic institutions, Haskell, other contractors, and unrelated organizations.

### Exact normalized overlap with the curated targets

Ten curated targets have an exact normalized match in the XPress export:

- Tyson Foods
- Mars
- Post Consumer Brands
- Joy Cone
- Keurig Dr Pepper
- Niagara Bottling
- Dairy Farmers of America
- Upstate Niagara Cooperative
- Sazerac Company
- Ecolab

Only five Highest Value companies have an exact normalized XPress match. Additional matches may exist through brand, subsidiary, punctuation, abbreviation, or ownership relationships. These require entity-resolution rules and should not be counted through aggressive fuzzy matching alone.

## Required ingestion model

### Raw import record

Preserve each workbook row with:

- Source filename
- Sheet name
- Source row number
- Import timestamp
- Original cell values
- File hash
- Import-batch identifier

### Organization candidate

Create or associate an organization only after normalization and resolution. Preserve the original company string as an alias or unresolved candidate.

### Engagement observation

PACK EXPO activity should create an engagement observation containing:

- Organization candidate
- Event name and year
- Source record
- Declared interests
- Industry response
- Company-role response
- Address candidate
- Repeat-record count

### Facility candidate

Do not create a confirmed facility solely from an event address. Store the address as a facility candidate and corroborate it through company, regulatory, permit, mapping, or official facility sources.

### Account priority

Use the curated Tier and Highest Value designations as account-strategy attributes. Keep them separate from signal confidence, opportunity stage, and project-maturity scores.

## Data-quality rules

- Preserve original company names.
- Normalize punctuation, whitespace, corporate suffixes, and common abbreviations.
- Use aliases and identifiers before fuzzy matching.
- Require reviewable evidence for parent or subsidiary relationships.
- Do not merge organizations solely because their normalized names are similar.
- Treat repeated event rows as engagement frequency, not duplicate companies to discard.
- Parse multi-select values against a controlled vocabulary. Do not split blindly on commas because several answer choices contain commas.
- Treat `No Response` as missing response, not a negative answer.
- Keep postal codes and identifiers as text.
- Preserve country and region as supplied, then map them to controlled codes.
- Track unresolved records and resolution confidence.
- Make every derived value traceable to the import record and transformation version.

## Recommended controlled vocabularies derived from the event data

### Capability affinity

- Process systems
- Packaging systems
- Material handling
- Automation and controls
- Inspection and quality
- Cold chain and refrigeration
- Distribution and warehousing
- Contract manufacturing and private label
- Packaging materials

### Event organization role

- Manufacturer or brand
- Co-manufacturer or private label
- Agent or distributor
- OEM or equipment provider
- Packaging or materials supplier
- Retailer
- Logistics or warehouse operator
- Academic or research
- Contractor or consultant
- Other
- Unknown

## Design consequence

The workbooks should seed the account graph and engagement layer. They should not directly seed confirmed facilities or opportunities. Automated external evidence must establish facility identity, project activity, timing, and Haskell relevance.

