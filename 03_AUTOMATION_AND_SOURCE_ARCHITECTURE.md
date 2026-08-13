# Automation and Source Architecture

## Architecture objective

Create a collection and processing system that remains useful without a dedicated analyst team. Automation failures should produce retries, degradation states, or concise operator actions. They should not create manual research tasks.

## Processing flow

1. Source registry schedules a connector.
2. Connector validates the destination and retrieves new or changed content.
3. Original content is stored with retrieval metadata and a content hash.
4. Extraction produces structured text and locators.
5. Entity resolution associates evidence with organizations and facilities.
6. Classification produces signals.
7. Duplicate and related signals are clustered.
8. Rules and models update opportunities and market trends.
9. Alerts, daily briefs, dashboards, and account timelines update.
10. Source health and model telemetry are recorded.

## Collection hierarchy

Use the first reliable and contractually permitted method available:

1. Official API or webhook
2. Licensed data feed
3. Validated RSS, Atom, or JSON Feed
4. Sitemap, structured data, or stable JSON endpoint
5. Static server-rendered HTML
6. PDF extraction
7. OCR for scanned or image-based documents
8. Constrained browser worker for a small number of explicitly approved sources

## Initial source families

| Source family | Purpose | Preferred method | Initial cadence |
| --- | --- | --- | --- |
| SEC EDGAR | Filings, capex, acquisitions, risk, facilities | API and filing documents | Hourly or daily |
| Company newsroom and IR | Facility and investment announcements | Feed, sitemap, structured page | Hourly or daily |
| Broad news discovery | Regional and trade reporting | GDELT or licensed API | Hourly |
| FDA food enforcement | Recalls and enforcement | openFDA API | Daily or weekly delta |
| USDA FSIS | Meat and poultry recalls and alerts | Recall API and feeds | Hourly or daily |
| EPA ECHO | Facility, permit, compliance, enforcement | Web services | Weekly delta plus targeted checks |
| Regulations.gov | Regulatory change | API | Daily |
| State and local incentives | Site selection and capital projects | API, feed, or approved adapter | Daily or weekly |
| Permits and planning | Facility project formation | ArcGIS, Socrata, Legistar, feed, or adapter | Daily or weekly |
| Event and marketing data | Account priority and engagement | Controlled import or approved integration | Event-driven |

Reference documentation:

- SEC: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- openFDA: https://open.fda.gov/apis/food/enforcement/
- FSIS: https://www.fsis.usda.gov/science-data/developer-resources
- EPA ECHO: https://echo.epa.gov/tools/web-services
- Regulations.gov: https://open.gsa.gov/api/regulationsgov/
- GDELT: https://www.gdeltproject.org/data.html
- ArcGIS query services: https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/

## Source registry contract

Every enabled source must define:

- Unique source identifier
- Display name and owner
- Source type
- Collection method
- Base URL
- Allowed domains
- Redirect policy
- Authentication method
- Schedule
- Expected update cadence
- Freshness SLA
- Query or watchlist scope
- Extraction method
- Required fields
- Minimum viable content checks
- Retry and timeout policy
- Operator-intervention policy
- Terms or license review status
- Data-retention restrictions
- Enabled or disabled state

## Source health

### Health states

- `healthy`
- `degraded`
- `action_required`
- `disabled`
- `unsupported`

### Required metrics

- Last attempted run
- Last successful run
- Last new record
- Expected next run
- Records discovered
- Records fetched
- Records extracted
- Records rejected
- Duplicate records
- HTTP error distribution
- Redirect violations
- Authentication failures
- Schema validation failures
- Extraction completeness
- Seven-day success rate
- Thirty-day success rate
- Consecutive failures
- Freshness lag

### Required anomaly detection

- Unexpected zero-result run
- Large unexplained record-count change
- Required field disappearance
- Content-type change
- New redirect domain
- Authentication expiration
- Pagination loop
- Duplicate explosion
- Extraction text below minimum threshold
- Source stale beyond SLA

## Run semantics

### `success`

All expected source operations completed and output passed validation.

### `unchanged`

Collection completed successfully and verified that no source content changed.

### `partial_success`

Some independent documents or pages completed while others failed. Successful outputs remain usable. Failed units enter retry or intervention handling.

### `failed`

The run did not produce trustworthy validated output.

### `action_required`

The connector cannot continue without a bounded operator action such as reauthorization, key replacement, or approval of a changed destination.

## Operator intervention

The Connector Care interface should:

- Describe the source and exact problem.
- State when collection last succeeded.
- State which coverage is affected.
- Present one bounded action.
- Resume from the last safe checkpoint.
- Confirm recovery with a dry run.
- Avoid requesting article copying or lead entry.

Permitted examples:

- Renew OAuth access.
- Replace an expired API key.
- Approve a known domain migration.
- Complete a CAPTCHA interactively when source terms permit it.
- Approve an updated extraction selector after validation.

Prohibited examples:

- Automated CAPTCHA solving.
- Credential collection through chat.
- Unapproved authenticated scraping.
- Copying content into the system as the normal fallback.
- Treating a failed run as zero new signals.

## Extraction requirements

- Archive original bytes before transformation where licensing permits.
- Preserve original and resolved URLs.
- Record HTTP status, content type, byte size, and response timestamp.
- Compute a content hash.
- Extract native PDF text before OCR.
- Preserve page numbers or selectors for evidence locators.
- Store extraction method and version.
- Validate minimum text and required fields.
- Preserve undated evidence without inventing dates.
- Use per-document isolation.
- Support deterministic reprocessing after extractor changes.

## Entity resolution

Resolution should use:

- Canonical company names
- Known aliases and abbreviations
- Parent and subsidiary relationships
- Brand ownership
- SEC CIK and other official identifiers
- Facility addresses
- Regulatory facility identifiers
- Domains and official websites
- Event-import names and addresses
- Human-approved mappings retained as durable rules

Ambiguous matches should remain unresolved or low confidence. They should not be silently assigned to the highest-profile company with a similar name.

## Language-model boundary

Appropriate uses:

- Structured fact extraction
- Entity candidate generation
- Signal classification
- Haskell capability alignment
- Evidence-grounded summaries
- Duplicate candidate generation
- Trend labeling
- Explanation generation

Inappropriate uses:

- Primary web retrieval
- Inventing missing facts or dates
- Treating model memory as evidence
- Bypassing source licensing
- Making unsupported project-value estimates
- Promoting an opportunity without stored evidence

Every model output should record provider, model, prompt version, schema version, timestamp, and confidence. Important classifications should be reproducible from stored evidence.

## Security

- HTTPS-only outbound requests
- Explicit domain and redirect allowlists
- DNS and IP validation to prevent SSRF
- Restricted content size and MIME types
- Sandboxed extraction workers
- Malware scanning where files are accepted
- No general-purpose open proxy behavior
- Separate credentials by connector
- Secret storage outside application data
- Least-privilege access
- Immutable audit events
- Rate-limit compliance
- License and retention enforcement

## Deployment recommendation

Use independent services or bounded modules for:

- Source registry and scheduler
- Connector workers
- Raw evidence storage
- Extraction and OCR
- Entity resolution
- Classification and clustering
- Opportunity scoring
- Search and retrieval
- Notifications and brief generation
- Source health and administration

These services can share infrastructure with the existing Haskell Hub where operationally sound. Food & Beverage should retain a separate domain model, taxonomy, watchlist, and interface.

