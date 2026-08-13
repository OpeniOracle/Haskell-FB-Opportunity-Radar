# UX Design Specification

## Experience objective

The interface should help a market leader or business-development user understand daily change, assess priority, inspect evidence, and decide what to do next within ten minutes.

The product should feel like a visual opportunity radar. It should not resemble a dense analyst case-management system or an unfiltered news feed.

## Design principles

- Lead with change and priority.
- Use plain language.
- Keep scores explainable.
- Reveal evidence progressively.
- Use maps, timelines, and trend velocity where they add meaning.
- Keep tables available for power users but secondary to visual summaries.
- Limit color to purposeful status and Haskell brand accents.
- Make empty, loading, stale, degraded, and failed states explicit.
- Ensure all status meanings remain understandable without color.

## Primary navigation

1. Pulse
2. Opportunities
3. Accounts
4. Market Trends
5. Map
6. Briefings

Secondary navigation:

- Alerts and subscriptions
- Saved views
- Administration
- Source Health
- User settings

## Pulse

### User question

What changed, what matters, and where should I focus today?

### Required components

- Date and freshness status
- Top new or changed opportunities
- Highest Value and Tier 1 activity
- Confirmed projects
- Emerging opportunities gaining momentum
- Trends gaining or losing velocity
- Geographic opportunity distribution
- Changes since the user's last visit
- Daily briefing access
- Compact source-health indicator

### Interaction

- Selecting a card opens the opportunity detail drawer or page.
- Users can Pursue, Watch, Assign, or Dismiss from the card.
- A “Why this is here” control explains scores and evidence.
- Filters should persist by user.

## Opportunities

### Default presentation

A visual card or compact list ordered by pursuit score and recent material change.

### Filters

- Opportunity stage
- Status
- Confidence
- Target tier
- Highest Value
- Market sector
- Haskell capability
- Geography
- Forecast horizon
- Evidence date
- Facility type
- Assigned user or team
- New or changed since date

### Opportunity card

- Company and parent
- Facility and location
- Opportunity title
- Opportunity stage
- Confidence
- Pursuit score
- Haskell capability alignment
- Forecast horizon
- Material change summary
- Why it matters to Haskell
- Evidence count and newest source date
- Account priority
- Pursue, Watch, Assign, Dismiss actions

## Opportunity detail

### Header

- Opportunity title
- Organization and facility
- Location
- Stage, confidence, status, and pursuit score
- Last material change
- Primary actions

### Main body

- Executive summary
- Why it matters to Haskell
- Recommended next action
- Haskell capability alignment
- Opportunity timeline
- Supporting signals
- Evidence cards with source, publication time, excerpt, and link
- Related market trends
- Related facilities and accounts
- Score explanation
- Audit and override history

### Score explanation

Show each component:

- Haskell fit
- Project maturity
- Potential scope
- Timing and momentum
- Account strategy
- Confidence multiplier

Do not show a score without the component explanation.

## Accounts

### Account list

- Canonical company name
- Parent company
- Organization role
- Target tier
- Highest Value flag
- Market sectors
- Active opportunities
- Latest activity
- Engagement indicator
- Coverage health

### Account detail

- Account summary
- Aliases, brands, subsidiaries, and divisions
- Facilities map and list
- Active and historical opportunities
- Evidence and signal timeline
- PACK EXPO or marketing engagement
- Related trends
- Saved notes and CRM link when available
- Monitoring sources and coverage status

## Facilities

Facilities can be reached through Accounts, Opportunities, and Map.

### Facility detail

- Facility name and operating organization
- Address and coordinates
- Facility type and operating status
- Known products and processes
- External regulatory identifiers
- Active opportunities
- Signal and evidence timeline
- Nearby related projects or infrastructure constraints
- Data freshness and provenance

## Market Trends

### User question

Which developments are changing the market, and which Haskell sectors or capabilities are affected?

### Trend card

- Trend name
- Direction and velocity
- Affected sectors
- Affected Haskell capabilities
- Number of independent organizations
- Number of facilities
- Geographic reach
- First observed and last updated
- Representative evidence

### Trend detail

- Plain-language assessment
- Velocity chart
- Supporting signal timeline
- Organizations and facilities involved
- Haskell capability implications
- Related opportunities
- Search terms and classification definition

The interface must label trends clearly and avoid presenting them as account opportunities.

## Map

### Layers

- Active opportunities
- Target-account facilities
- Confirmed projects
- Emerging and developing opportunities
- Cold-storage and distribution facilities
- Regulatory and infrastructure signals
- Selected market-trend density

### Map behavior

- Cluster at national and regional zoom levels.
- Show counts by stage, not a wall of pins.
- Filter by sector, capability, tier, confidence, and time.
- Selecting a location opens a facility or opportunity preview.
- Provide a synchronized list for accessibility and precise review.

## Briefings

### Daily briefing

- Top five developments
- Tier 1 and Highest Value account changes
- New confirmed opportunities
- Emerging opportunities gaining momentum
- Material negative developments
- Important market trends
- Source-coverage exceptions

### Weekly briefing

- Opportunity pipeline movement
- New, promoted, dismissed, and closed opportunities
- Sector trend movement
- Geographic concentration
- Account coverage
- Source reliability

Briefings should be generated automatically from stored structured data and evidence. They should include direct source links and should not require manual compilation.

## Alerts and subscriptions

Users should be able to subscribe by:

- Account
- Facility
- Sector
- Haskell capability
- Geography
- Opportunity stage
- Confidence
- Trend

Alert types:

- Immediate critical alert
- Daily digest
- Weekly summary
- Source action required for administrators

The same signal should not generate repeated alerts unless a material change occurs.

## Administration and Source Health

### Overview

- Healthy, degraded, action-required, disabled, and unsupported source counts
- Freshness SLA violations
- Recent failed and partial-success runs
- Authentication expirations
- Schema changes
- Coverage affected by failures

### Connector Care task

- Source name
- Exact problem
- Last successful collection
- Accounts, sectors, or geographies affected
- Required bounded action
- Test and resume control
- Audit record

## Natural-language query

Provide evidence-grounded query over stored data. Example:

> Show Tier 1 beverage accounts in the Southeast with new capacity, packaging, automation, or cold-storage signals in the past 30 days.

Answers must:

- Use stored entities and evidence.
- Show applied filters.
- Link to supporting records.
- State when coverage is incomplete.
- Avoid treating model memory as evidence.

## Visual language

- Warm white or very light neutral backgrounds
- Charcoal text
- Haskell brand accent color used sparingly
- Strong typographic hierarchy
- Rounded but restrained cards
- High information density only in expanded views
- Clear map and chart legends
- Short labels and concise summaries
- Minimal decorative illustration

## Responsive behavior

Desktop is the primary planning surface. Mobile should support:

- Pulse review
- Alert review
- Opportunity detail
- Evidence access
- Pursue, Watch, Assign, and Dismiss actions
- Saved-view filtering

Complex administration and source configuration can remain desktop optimized.

## Accessibility

- WCAG 2.2 AA target
- Keyboard-accessible controls
- Visible focus states
- Semantic headings and regions
- Status icons and text in addition to color
- Minimum readable typography
- Adequate contrast
- Accessible charts with text summaries
- Map results available as a synchronized list

