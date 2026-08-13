# Product Brief

## Product statement

The Haskell Food & Beverage Opportunity Radar is an internal, automation-first market intelligence and business-development platform. It continuously monitors target companies, facilities, relevant market sectors, and authoritative sources to identify emerging capital-project signals, operational needs, facility investments, and market trends aligned with Haskell capabilities.

## Business problem

The Food & Beverage department currently runs recurring searches through ChatGPT and compiles reports manually. This creates several limitations:

- Collection depends on individual prompting and timing.
- Results are difficult to reproduce or audit.
- Coverage is inconsistent across companies, geographies, and source types.
- Duplicate stories can appear as separate developments.
- Company aliases and subsidiaries fragment account history.
- Broad trends can be mistaken for qualified opportunities.
- Extraction failures create manual work that the department cannot staff.
- No persistent facility or opportunity timeline exists.
- Users cannot easily see what changed since the prior report.

## Product outcome

The platform should give business-development and market leaders a reliable daily view of:

- New and changed opportunities
- Activity involving Tier 1 and Highest Value accounts
- Facilities showing investment or modernization indicators
- Trends gaining or losing momentum
- The Haskell capability most relevant to each development
- Evidence and confidence supporting each assessment
- Sources that are healthy, degraded, stale, or require action

## Primary users

### Market leader

Needs a concise view of high-value opportunities, market movement, and where to focus relationship-building.

### Business-development professional

Needs account-specific developments, facility context, evidence, recommended next actions, and alert subscriptions.

### Subject-matter expert

Needs opportunities filtered by process, packaging, automation, refrigeration, utilities, analytics, and sector specialization.

### Platform administrator

Needs source configuration, connector health, authentication status, schema-change alerts, ingestion history, and auditability.

### Executive viewer

Needs a short visual briefing on opportunity pipeline, strategic accounts, trend movement, and geographic concentration.

## Haskell capability model

The product should align signals to these capability groups:

- Planning and consulting
- Architecture and facility design
- Engineering
- Design-build and EPC
- Process systems
- Packaging systems
- Material handling
- Automation and controls
- Utilities and refrigeration
- Cold storage and ASRS
- System analytics and modeling
- Industrial water and wastewater
- Construction and commissioning

## Market coverage

- Snacks and baking
- Candy and chocolate
- Pet food and treats
- Protein and ready-to-eat
- Alternative protein
- Coffee
- Agri-science and ingredients
- Frozen foods, soups, sauces, condiments, and prepared foods
- Cold storage and distribution
- Beverage
- Dairy
- Beer, wine, and spirits
- Consumer products where the delivery capabilities overlap

## Core product principles

### Evidence first

Every opportunity is an assessment supported by one or more retrievable evidence records. The interface must make the reasoning inspectable.

### Facility aware

The company is the account. The facility is where the physical opportunity occurs. Parent, subsidiary, brand, and site relationships must remain explicit.

### Automation first

The system must collect, extract, normalize, classify, cluster, score, and deliver intelligence without routine analyst processing.

### No silent failure

An empty run is not assumed successful. The platform must know the difference between no new content and failed collection.

### Separate facts from assessment

Evidence preserves what the source reported. Signals are normalized events derived from evidence. Opportunities and trends are assessments derived from signals.

### Simple daily use

The default interface should highlight change and priority. Users should not need to learn an intelligence-analysis workflow.

### Reusable foundation

Source collection, evidence storage, entity resolution, observability, and security should form a reusable intelligence kernel. Food & Beverage retains its own ontology, scores, workflows, and presentation.

## Functional requirements

### Account intelligence

- Import and normalize target-account workbooks.
- Maintain aliases, subsidiaries, brands, divisions, and parent relationships.
- Classify organization role and market sectors.
- Store target tier, Highest Value status, engagement history, and account notes.
- Show a chronological account activity timeline.

### Facility intelligence

- Maintain facility name, type, address, coordinates, operating status, and external identifiers.
- Link multiple companies or brands to a facility when supported by evidence.
- Distinguish proposed, active, expanding, idled, closing, and closed facilities.
- Map facility-level signals and opportunities.

### Collection

- Schedule sources by expected cadence.
- Archive original evidence before transformation.
- Support APIs, feeds, structured pages, static HTML, PDFs, OCR, and approved constrained-browser connectors.
- Track authentication and operator-intervention requirements.
- Detect schema changes and anomalous zero-result runs.

### Intelligence processing

- Extract entities, places, dates, money, quantities, project actions, and quoted evidence.
- Resolve evidence to companies and facilities.
- Classify signal family, event type, Haskell alignment, lifecycle, and confidence.
- Cluster duplicate or related reporting into a single signal timeline.
- Promote signals into opportunities through documented rules.
- Cluster broad signals into market trends without creating false opportunities.

### Delivery

- Provide a daily Pulse view.
- Provide automated daily briefings.
- Send immediate alerts for defined high-priority events.
- Support saved filters and subscriptions.
- Provide evidence links and audit history.
- Export concise summaries for meetings and account planning.

### Feedback

- Allow Pursue, Watch, Assign, Dismiss, and Close actions.
- Capture a reason for dismissals and overrides.
- Preserve computed scores beneath manual overrides.
- Use feedback to tune rules and models without erasing history.

## Non-functional requirements

- Secure tenant-isolated access
- HTTPS-only outbound collection
- Domain and redirect allowlists
- SSRF protections
- Role-based administration
- Idempotent processing
- Durable queues with retry and backoff
- Raw evidence retention and content hashing
- Structured audit logs
- Deterministic recomputation where practical
- Accessible responsive interface
- Observable collection and model performance
- Clear data-retention and licensing controls

## Out of scope for the first release

- Fully automated outbound sales contact
- Automated bidding or proposal submission
- Unapproved social-network scraping
- CAPTCHA solving
- Autonomous opportunity publication to external clients
- Predictive project-value claims without evidence
- Comprehensive global municipal permitting coverage
- Replacement of Haskell's CRM

