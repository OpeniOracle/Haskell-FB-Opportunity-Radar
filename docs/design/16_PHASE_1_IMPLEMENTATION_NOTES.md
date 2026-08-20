# 16 — Phase 1 Implementation Notes (PR 1 and PR 2)

**Status:** All seven Phase 1 surfaces implemented against fixtures
**Scope:** Phase 1 PR 1 (application shell) and roadmap PR 2 (the five remaining surfaces)
**Milestone plan:** `docs/design/15_PHASE_1_IMPLEMENTATION_PLAN.md`
**Version:** 2.0

---

## 1. What this milestone is

The first Netlify-renderable application milestone. It exists so the interface can
be reviewed as software rather than as a specification, before any connector,
migration, or model call is built.

It ships:

| # | Deliverable | Where |
|---|---|---|
| 1 | Frontend application scaffold | `app/` |
| 2 | Package and build configuration | `app/package.json`, `app/vite.config.ts`, `app/tsconfig.json` |
| 3 | Netlify configuration and SPA routing | `netlify.toml`, `app/public/_redirects` |
| 4 | CI checks | `.github/workflows/ci.yml` |
| 5 | Responsive application shell | `app/src/components/AppShell.tsx`, `NavRail.tsx` |
| 6 | Primary and contextual route structure | `app/src/routes.ts`, `app/src/App.tsx` |
| 7 | Documented design tokens | `app/src/styles/tokens.css` |
| 8 | Light and dark themes | `tokens.css`, `app/src/components/ThemeToggle.tsx` |
| 9 | Navigation | `app/src/components/NavRail.tsx` |
| 10 | Typed fixture models | `app/src/types/domain.ts` |
| 11 | `DataSource` interface | `app/src/data/DataSource.ts` |
| 12 | Fixture-backed `DataSource` implementation | `app/src/data/fixtureDataSource.ts` |
| 13 | Daily Pulse surface | `app/src/surfaces/Pulse.tsx` |
| 14 | Opportunities surface | `app/src/surfaces/Opportunities.tsx` |
| 15 | Loading, empty, degraded, stale, unavailable states | `app/src/components/SurfaceStates.tsx` |
| 16 | Placeholder states for later routes | `app/src/surfaces/Placeholder.tsx` |

---

## 2. Framework decision — and what it is not

**Decision:** React 18 + TypeScript 5 + Vite 5, with `react-router-dom` for routing.

**Status:** Reversible, frontend-only. **This is not a D2b vendor selection and does
not pre-empt one.**

### Why a decision was needed

The design package specifies surfaces, states, and an interaction model, but names
no frontend framework. A Netlify-renderable milestone cannot be built without one,
so the choice was made here and recorded rather than left implicit.

### Why this one

1. **It is a build-time toolchain, not a service.** React, TypeScript and Vite run
   during `npm run build` and emit static files. There is no vendor account, no
   API key, no runtime dependency on any hosted service. Nothing about this choice
   commits Haskell to a supplier relationship.
2. **Reversibility is structural, not aspirational.** Every domain type lives in
   `src/types/domain.ts` and every data access goes through the `DataSource`
   interface. Both are plain TypeScript with no React import. A framework change
   would rewrite the presentation layer and leave the model and the data seam
   intact.
3. **The output is portable.** The build produces static HTML, CSS and JS. It runs
   on Netlify, on any static host, or behind Haskell's own infrastructure without
   modification.
4. **It is the least surprising option for handover.** Whoever maintains this
   after Phase 1 is more likely to have React and TypeScript experience than any
   alternative, and TypeScript is what lets the D15 temporal model and the D16
   confidence axes be enforced by the compiler rather than by convention.

### What it explicitly does not decide

- It does not select an **AI model provider** (D2b). No model is called anywhere
  in this milestone, and there is no client, SDK, or key for one.
- It does not select a **database**, **hosting**, or **connector** vendor.
- It does not commit to a **design system** (D10 — see §4).
- It does not commit to React for any future server-side or backend component.

### Dependency inventory

Runtime dependencies are three packages, all MIT-licensed:

| Package | Version | Purpose |
|---|---|---|
| `react` | ^18.3.1 | UI rendering |
| `react-dom` | ^18.3.1 | DOM renderer |
| `react-router-dom` | ^6.26.2 | Client-side routing |

Everything else — Vite, TypeScript, ESLint, Vitest, Testing Library, jsdom — is a
development dependency and is absent from the shipped bundle. There is no UI
component library, no CSS framework, no icon package, no charting library, no
analytics, and no state-management library. Icons are hand-authored SVG in
`src/components/Icon.tsx`, because status shapes must be distinguishable in
greyscale and an interchangeable icon font would undermine that.

Production bundle after the v1.1 refinement: **221 kB raw / 69 kB gzipped JS**,
**34 kB raw / 6 kB gzipped CSS**.

---

## 3. Architecture — the two seams that matter

### 3.1 The `DataSource` interface

```ts
export interface DataSource {
  readonly meta: DataSourceMeta
  getPulse(): Promise<SurfaceState<PulseSnapshot>>
  getOpportunities(): Promise<SurfaceState<Opportunity[]>>
}
```

Surfaces obtain this through `useDataSource()` and never construct one. PR 9 adds an
API-backed implementation and changes the provider — it does not "replace the
mock", because the mock was never something a surface knew about.

This boundary is enforced in CI, not by convention: `app/eslint.config.js` makes it
an **error** for any file outside `src/data/fixtures/**`, `src/data/fixtureDataSource.ts`
and `src/test/**` to import a fixture module.

### 3.2 `SurfaceState<T>` as a union

```ts
export type SurfaceStatus<T> =
  | { kind: 'loading' }
  | { kind: 'empty'; reason: string }
  | { kind: 'unavailable'; reason: string; blockedBy: string }
  | { kind: 'degraded'; data: T; notice: string; affected: string[] }
  | { kind: 'stale'; data: T; notice: string; asOf: string }
  | { kind: 'ready'; data: T }

// `checkedAt` rides on every state, including the failures: "when was this last
// checked" is the one question a user cannot infer from anything else on screen.
export type SurfaceState<T> = SurfaceStatus<T> & { checkedAt: string | null }
```

Non-happy states are part of the type, so a surface cannot render a happy path for
data that is degraded or stale by forgetting to check a flag. Note the deliberate
asymmetry: `empty` and `unavailable` carry no data and replace the content;
`degraded` and `stale` carry data and sit *above* content that is still worth
reading. A notice that hides what it qualifies is worse than no notice.

### 3.3 Decisions encoded structurally — and their actual status

**Corrected in v1.3.** An earlier version of this table was headed "Approved decisions"
and listed five rows as though all five were approved. Three were not. Decision status in
`13_GATE_1_DECISION_PACKET.md` and ADR status in `docs/adr/README.md` are authoritative;
this table now restates each at its real status.

| Decision / ADR | Status | How it is encoded |
|---|---|---|
| **D15 / ADR 0004** — temporal precision | **Approved / Accepted** | `TemporalValue` is an interval with `precision` and `basis`. No bare `Date` field exists. "by spring 2029" renders as *spring 2029*, never as a fabricated 31 March. |
| **D24 / ADR 0012** — corrections | **Approved / Accepted** | Corrections supersede rather than overwrite. Encoded in the model; rendered by the Evidence detail surface in roadmap PR 2. |
| **D18 / ADR 0005** — entity resolution | **Approved / Accepted IN PART** — the time-bounded, evidence-backed ownership corollary only. The conservative-resolution ladder remains **Proposed** pending Gate G-4. | Half-open `[from, to)` intervals with as-at-date attribution. |
| **D11** — scope class for four non-core accounts | **Approved provisionally**; confirmation required before pilot metrics are finalised | `scopeClassStatus` surfaces a provisional classification rather than presenting it as settled. |
| **D16 / ADR 0009** — three confidence axes | **D16 is OPEN** (owner: market leader + SMEs, due before the Phase 3 UI build). **ADR 0009 is Proposed**, to be ratified at Gate G-2. | Three independent axes are displayed on illustrative fixture data as the ADR's recommended default. **This is not an implementation of a ratified decision and must not be cited as one.** |
| **D19 / ADR 0006** — evidence access modes | **D19 is OPEN. ADR 0006 is Proposed**, ratified at G-2 (rules) and G-3 (licensing). | Access mode is displayed as a recorded attribute. **No promotion rule is implemented.** |
| **D17 / ADR 0010** — health vs coverage | **D17 is OPEN. ADR 0010 is Proposed**, ratified at G-3 and G-6. | Coverage and connector health are rendered as two independent figures, never merged. The *separation* follows the proposed default; **no coverage measurement model is implemented.** |

`docs/adr/README.md` defines **Proposed** as "recommended default from the design
response; not yet ratified." Following a proposed default in a fixture preview is
legitimate. Describing it as approved is not.

**No decision status was changed by this milestone.** `13_GATE_1_DECISION_PACKET.md` is
untouched.

## 4. Design tokens — provisional, and marked as such

**D10 (design system and brand assets) remains OPEN.** Every value in
`app/src/styles/tokens.css` is a considered placeholder, and the file says so at
the top. This interface is the design proof for stakeholder review, not an
approved design system.

The palette avoids the failure modes named in the brief:

- **Warm, low-chroma ground** (`#faf8f5`), not stark white and not blue-grey SaaS
  default.
- **One accent** — a deep petrol `#0f5661`, used for navigation state, links, and
  score bars. Never decoratively.
- **No gradients on surfaces, no glass, no purple-indigo AI-dashboard palette.**
  The single striped/purple treatment in the product is the illustrative-data
  marker, which is meant to look like a warning label rather than a style.
- **One shadow family and one radius family.** Cards are separated by hairline
  borders and generous space, not by depth.
- **No decorative charts.** The only quantitative graphics are the five score bars
  inside the disclosure, each of which is a labelled proportion of a published cap.

When D10 lands, the accent ramp and the typeface stack are the values expected to
change. Everything else is structural.

### Status indicators

Every status carries **colour + a distinct icon shape + a text label**, always.
`StatusPill` has no icon-only variant and no prop that removes the label. The
icons are hand-drawn specifically so "confirmed" (check), "developing" (clock),
"emerging" (spark) and "attention" (triangle) remain tellable apart in greyscale.

### Contrast

`src/test/contrast.test.ts` computes WCAG 2.1 contrast ratios from the token file
itself and asserts 4.5:1 for text pairs and 3:1 for non-text UI boundaries, **in
both themes**. 42 assertions, all passing.

One change came out of this: `--c-border-strong` (1.70:1 on surface) was being
used for button borders. It is a divider emphasis, not a control boundary, so
`--c-border-interactive` was added at 3.61:1 (light) and 4.21:1 (dark) and is now
what delimits interactive controls.

---

## 5. Routes

**Corrected in v1.3.** The table PR 1 originally shipped had the right count and the wrong
contents. The authoritative inventory is `15_PHASE_1_IMPLEMENTATION_PLAN.md` §11.2 and
§11.4: **seven surfaces across five primary navigation entries and two contextual routes.**

| # | Surface | Route(s) | Nav | Status |
|---|---|---|---|---|
| 1 | Daily Pulse | `/` | Primary | **Built** (PR 1) |
| 2 | Opportunities | `/opportunities`, `/opportunities/:opportunityId` | Primary | **Built** (PR 1) |
| 3 | Company | `/accounts`, `/accounts/:accountId` | Primary | **Built** (PR 2) |
| 4 | Facility | `/facilities/:facilityId` | **Contextual** | **Built** (PR 2) |
| 5 | Evidence detail | `/evidence/:evidenceId` | **Contextual** | **Built** (PR 2) |
| 6 | Source Health & Coverage | `/admin/health` | Primary | **Built** (PR 2) |
| 7 | Saved Pursuits & Watches | `/views` | Primary | **Built** (PR 2) |

A surface may own more than one route. `/opportunities/:id` and `/accounts/:id` are routes
of their parent surface, **not separate surfaces** — counting them as such is exactly the
error that displaced Facility and Evidence detail from the seven.

**Reserved, not surfaces.** Market Trends (`/trends`), Map (`/map`) and Briefings
(`/briefings`) are not Phase 1 surfaces; all three depend on signals, opportunities or
alerting. §11.4: "the navigation reserves their positions and renders them as explicitly
unavailable rather than hiding them, so the eventual shape is visible from the first
preview." They are modelled separately in `routes.ts` so they can never be counted among
the seven again, and their placeholder wording ("Not part of Phase 1") is deliberately
different from the scheduled-surface placeholder ("Scheduled, not yet built"). All seven
surfaces are now built, so nothing routes to that placeholder today; it remains as the
failure mode for a route registered in the inventory ahead of its component.

`*` renders an explicit not-found state rather than redirecting, because a silent redirect
hides the mistake.

---

## 6. Fixture data

All fixtures are fabricated. Every organization is named `Example …`, following the
convention the design package itself established in `schemas/sample-opportunity.json`.
`src/test/boundaries.test.ts` asserts that no real pilot-account name appears
anywhere in the source tree.

The six opportunity fixtures are chosen to exercise the design rather than to look
plausible. Between them they cover all three lifecycle stages; six of the nine
temporal precisions including `season` and an inferred basis; the
authoritative-evidence-plus-inference combination that ADR 0009 exists for; a
provisional D11 classification; a `reference_only` evidence ceiling; and an
opportunity moved to on-hold by a negative signal rather than deleted.

### Previewing the five states

Append `?state=<name>` to any route — `loading`, `empty`, `degraded`, `stale`,
`unavailable`. A "Preview surface states" control in the navigation footer links to
each. This is fixture-only scaffolding and disappears with the fixture
`DataSource`; it exists so the non-happy states can be *looked at* during review
rather than taken on trust.

---

## 7. Milestone boundaries — asserted, not promised

The instruction for this milestone forbids migrations, infrastructure, vendor
selection, authentication, model calls, connectors, real evidence, and PACK EXPO
data. None of those are present. `src/test/boundaries.test.ts` enforces the
machine-checkable subset across the whole source tree:

| Assertion | Result |
|---|---|
| No `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource` call | Pass |
| No remote origin referenced in any source file | Pass |
| No credential-shaped value (API key, secret, token, private key, `sk-`/`ghp_` prefix) | Pass |
| No `process.env` or `import.meta.env` read | Pass |
| No real pilot-account or PACK EXPO name in any source file | Pass |

ESLint adds `no-restricted-globals` on `fetch` and `no-restricted-imports` on
fixture modules. The CI workflow additionally fails if a `migrations/` directory
appears, if a credential-shaped file becomes tracked, or if the Netlify
configuration stops pointing at the app.

**No secrets or production data are present in this milestone.** There is no `.env`
file, no environment variable is read, no credential is committed, and the entire
data layer is six fabricated opportunities and one fabricated pulse snapshot.

---

## 8. Verification

| Check | Command | Result |
|---|---|---|
| Clean dependency install | `npm install` | 288 packages, no errors |
| Type checking | `npm run typecheck` | Pass (strict, `noUncheckedIndexedAccess`) |
| Linting | `npm run lint` | Pass, 0 errors, 0 warnings |
| Automated tests | `npm test` | **104 passed / 104**, 8 files |
| Production build | `npm run build` | Pass, 1.2 s |
| Route validation | `src/test/routes.test.tsx` | 10 tests — every route renders, nav lists exactly the primary five |
| Netlify config validation | CI `boundaries` job + `dist/_redirects` present after build | Pass |
| Desktop and mobile visual checks | `npm run screenshots` (1440×1000 and 390×844) | Captured, both themes |
| Keyboard navigation and focus visibility | `src/test/accessibility.test.tsx` | Skip link present; theme cycles via keyboard; disclosure opens via keyboard; a single `outline: none` paired with `:focus:not(:focus-visible)` |
| Reduced-motion behaviour | `src/test/accessibility.test.tsx` | Motion tokens zeroed; skeleton shimmer disabled; screenshots captured with `reducedMotion: 'reduce'` |
| Contrast | `src/test/contrast.test.ts` | 42 assertions across both themes |
| No secrets or production data | `src/test/boundaries.test.ts` + CI | Pass |

Test breakdown: routes 10, surface states 9, illustrative marking 10, opportunity
cards 8, accessibility 10, contrast 42, formatting 6, boundaries 9.

---

## 9. Known visual limitations

Honest list, for the review:

1. **Tokens are provisional.** The accent, the warm neutrals and the type stack are
   placeholders chosen to satisfy the UX spec. D10 is open.
2. **No Haskell brand assets.** The wordmark is set in the system typeface with a
   generic glyph. No logo file was supplied and none was invented beyond a neutral
   placeholder mark.
3. **System font stack only.** No webfont is loaded, so the product renders in
   whatever the platform provides. This keeps the CSP tight and the bundle small,
   but the typography will shift once a brand typeface is chosen.
4. **Opportunity cards are long.** Six cards make a tall page, and on a 390 px
   viewport the ranked list is roughly 19 000 px. Filtering, grouping and
   pagination are later milestones; this build shows the full list deliberately so
   the card itself can be judged.
5. **The mobile nav is an icon bar without a labelled drawer.** Labels are supplied
   as accessible names, but a sighted mobile user sees icons only. A labelled
   drawer is worth considering if mobile turns out to matter.
6. **"Open account" is disabled** on every card, because `/accounts/:accountId` is
   a later milestone. It is present so the card's action affordance can be
   reviewed, not because it works.
7. **Relative times are computed against a fixed reference instant**
   (`FIXTURE_NOW`, 2026-08-17T08:00Z) so screenshots and tests stay reproducible.
   Live data will use the real clock.
8. **The "Preview surface states" control is scaffolding** and will be removed with
   the fixture `DataSource`.
9. **No print stylesheet.** Not in scope for this milestone.

---

## 10. What was deliberately not done

Per the milestone boundaries: no database migration was created or run, no
infrastructure was provisioned, no D2b vendor was selected, no authentication was
implemented, no AI model was called, no connector was built or activated, no real
evidence or company activity was used, neither PACK EXPO workbook was imported,
Phase 1 PR 2 was not started, and the implementation pull request was not merged.

Work stops here pending visual review of the Netlify preview.

---

## 11. UX refinement (v1.1)

Stakeholder objective for this pass: **a Food & Beverage business-development
user should understand what changed, what matters, and what to do next in under
ten minutes.** The architecture, typed fixtures, `DataSource` boundary,
accessibility protections, theme support, and milestone restrictions are
unchanged.

### 11.1 Daily Pulse — commercial first, operations second

The page opened with a chronological mix of project confirmations and connector
recoveries, three metric cards padded with implementation prose, and no statement
of what to do. It now reads:

1. **Needs attention today** — the changes flagged `needsAttention`, each with a
   reason to act and a `Review opportunity` link.
2. **Three summary figures** — one-line notes; the four-account coverage list and
   the coverage-versus-health explanation moved behind disclosures.
3. **Other market changes** — the remaining commercial changes.
4. **Coverage and system notices** — quiet, compact, and collapsed unless
   something needs a person.

The split is structural, not cosmetic: `ChangeEvent.channel` is now `market` or
`system` **in the data**, so a view cannot drift back to matching on `kind`. The
operations section opens only when `connectorHealth.actionRequired > 0` or an
account is below expected coverage. Coverage and connector health remain two
separate figures, per ADR 0010.

The caught-up state is now **"You're caught up" / "No material changes have been
identified since your last visit."**

### 11.2 Opportunities — a comparison surface

Cards were fully expanded, so six opportunities ran to roughly 4,300px on desktop
and 19,000px on a phone. Comparing two of them meant scrolling past both.

The compact card now carries exactly the triage set: account, title, location or
the named unresolved state, priority score **and band**, stage, pursuit status,
confidence, expected timing, primary capability, evidence count, newest evidence
date, one sentence, and `Review opportunity`.

Moved into the drawer: the full assessment, the three confidence axes with what
they mean, the score breakdown, publisher counts and access mode, operator
attribution, provisional classification, timing caveats, and the complete
capability list. The drawer moves focus to its close button, traps Tab, closes on
Escape, and returns focus to the trigger.

**Controls** (all fixture-backed, all in-browser — no request, no endpoint, no
backend dependency): search across account, project, location and capability;
filters for priority band, stage, pursuit status, confidence, geography and
capability; and sort by priority, newest evidence, or expected timing. Filter
options are derived from the data, so no filter is offered that would return
nothing. Timing sort puts the undated opportunity last rather than inventing a
position for it. On a phone the seven controls fold behind a summary so an
opportunity is visible without scrolling.

**Actions.** `Open account` was a disabled button; it is replaced by
`Review opportunity`, which works. Pursue, Watch, Assign and Dismiss are live
local previews held in component state — selecting the same one again clears it.
They are deliberately *not* written to `localStorage`, because that would look
like persistence without being it. The list says once, above the cards, that
nothing is saved; a chosen decision then shows its own confirmation.

### 11.3 Illustrative-data treatment

The striped ribbon is the persistent marker. The full-width purple panel on
Opportunities repeated it and pushed content below the fold, so it is gone,
replaced by a compact note beside the results count. The boundary tests that
prohibit real accounts, remote origins, credentials, and network calls are
unchanged and still passing.

### 11.4 Mobile navigation

The icon-only bar is replaced by a **labelled bottom navigation bar** — icon plus
short text label for all five destinations, with an active state — alongside a
compact brand header. Exactly one navigation renders at a time (`useMediaQuery`
rather than CSS), so there is a single `Primary` landmark in the accessibility
tree instead of one visible and one hidden.

### 11.5 States

Each state answers four questions in order — what happened, does the user need to
act, what happens next, and when it was last checked. `checkedAt` now rides on
every `SurfaceState`, including the failures. Technical causes moved behind a
"Technical detail" disclosure: the headline is now "Opportunities aren't ranked
yet", not "scoring has not run against the current taxonomy version". The
oversized centred containers are gone; states are compact horizontal panels.

### 11.6 Visual

Light stays the default; dark remains a preference. `--c-text-muted` was darkened
from `#7d766d` to `#6f685f` (light) and lightened to `#979088` (dark), and
`--c-text-secondary` likewise — both now clear **4.5:1 on every surface they are
used on**, not just the 3:1 non-text floor, and the contrast suite asserts it.
Vertical rhythm was tightened throughout without reducing the spacing scale. No
UI library, charting package, or new visual dependency was added; the runtime
dependency list is still three packages. The placeholder brand mark is unchanged
pending official assets.

One rendering defect was found and fixed on the way: the score bars in the
breakdown were invisible, because `.score-row__bar` is a `<span>` and an inline
box gives its fill nothing to grow into.

### 11.7 Verification

163 tests across 12 files, all passing. New coverage:

| Area | File |
|---|---|
| Search, filters, sort, priority bands, derived options | `opportunityFilters.test.ts` (21) |
| Filters/sort/actions through the real controls | `opportunityWorkspace.test.tsx` (12) |
| Compact card contents, drawer contents, keyboard contract | `opportunityCard.test.tsx` (12) |
| Market/system separation, attention section, metric disclosures | `pulse.test.tsx` (10) |
| Revised empty, degraded, unavailable states | `surfaceStates.test.tsx` (11) |
| Labelled mobile navigation, single landmark, folded filters | `navigation.test.tsx` (8) |

### 11.8 Limitations that remain

Tokens are still provisional (D10 open); there are still no Haskell brand assets
and no webfont; local decisions are still not persisted, by design; and there is
still no print stylesheet. The mobile-nav limitation from v1.0 is resolved. The
card-length limitation is resolved — six opportunities now fit a comparison
rather than filling six screens.

---

## 12. Deep linking from Daily Pulse (v1.2)

The "Review opportunity" links under *Needs attention today* navigated to the
Opportunities list and left the user to find the record themselves. They now open
it directly.

**URL as the source of truth.** Drawer state moved out of component state and into
a query parameter, `?opportunity=<id>`. That is what makes the address shareable
and reload-safe and gives the back button something to return to. `OPPORTUNITY_PARAM`
and `opportunityLink()` live in `lib/opportunityFilters.ts` so Daily Pulse and
Opportunities cannot drift apart on the format. Any other parameter already in the
URL — the fixture state previewer, for instance — is carried through the link and
preserved when the drawer closes.

| Behaviour | How |
|---|---|
| Deep link opens the drawer | Push navigation, so **Back returns to Daily Pulse** |
| Card opens the drawer | Push, so Back closes the drawer without leaving the surface |
| Close | **Replace**, removing only `opportunity` — never navigates out of the application, which matters when a shared link is the first entry in history |
| Reload | The parameter is the only state, so the same URL reproduces the same drawer |
| Unknown, empty, or malformed id | Resolves to nothing and opens nothing; it never falls through to a neighbouring record |
| Filter would hide the record | The drawer resolves against the **full** set, never the filtered view, and the active filter is left untouched |
| Focus | Enters the drawer's close button on open. On close it returns to whatever opened it; when the drawer was opened by a URL there is nothing to return to, so it lands on that card's own review button, or the main region if the card is not rendered |

**One real defect surfaced on the way.** Both surfaces keyed their data load on the
whole query string. That was invisible until the drawer started writing to the
URL: opening or closing it tore down and rebuilt the entire list, which destroyed
the card focus was meant to return to. The scenario already reaches a surface
through the `DataSource` identity, so the query string was never a data dependency
and has been removed from both.

The compiled CSS is byte-identical to v1.1 — this pass changed behaviour only.

**Tests:** `src/test/deepLink.test.tsx`, 22 tests across six groups — link targets,
query-driven opening, reload safety, invalid identifiers, close behaviour, browser
back, and focus handling. A `renderAppWithHistory` helper was added because
`MemoryRouter` cannot exercise the address bar or the back button. Suite total: 185
tests across 13 files.

---

## 14. Reconciliation of merged PR 1 (v1.3)

A read-only reconciliation against the merged repository found that PR 1 shipped two
errors of authority. This corrective pass fixes both. It implements no roadmap PR 2
surface and changes no decision status.

### 14.1 The route inventory named the wrong seven surfaces

PR 1 reconciled the inventory to a **count** of seven without checking the **composition**
in §11.2. What shipped, against what the plan requires:

| Shipped in PR 1 | Authoritative §11.2 |
|---|---|
| `/trends` — primary, counted as a surface | Market Trends is **not a Phase 1 surface**; it is a reserved position |
| `/operations` — "Operations" | The surface is **Source Health & Coverage** at **`/admin/health`** |
| `/opportunities/:id` — counted as a contextual surface | A route of the **Opportunities** surface |
| `/accounts/:id` — counted as a contextual surface | A route of the **Company** surface |
| — missing — | **Facility** (`/facilities/:id`), contextual surface 4 |
| — missing — | **Evidence detail** (`/evidence/:id`), contextual surface 5 |
| — missing — | **Saved Pursuits & Watches** (`/views`), primary surface 7 |
| — missing — | Reserved positions for **Map** and **Briefings** |
| "Accounts" | The surface is named **Company** |

`routes.ts` is now surface-oriented rather than route-oriented, because that is the
distinction the plan draws and the one the previous model could not express. Reserved
destinations are a separate type from surfaces, so a non-Phase-1 destination cannot be
counted among the seven by accident. `src/test/routes.test.tsx` asserts the seven **by
name**, not by count — a count-only test is what let this through.

### 14.2 Deep links resolved to a drawer, not the full page

`10_DESIGN_RESPONSE.md` §5.3: "card → drawer → 'Open full detail' for the complete record.
**Deep links always resolve to the full page** so a brief or Teams alert lands somewhere
shareable." PR 1 addressed an opportunity as `/opportunities?opportunity=<id>`, which
reopened the drawer.

Corrected: the full page at `/opportunities/:opportunityId` is the shareable address. The
drawer remains for in-session triage and now holds **no URL state at all**, which is what
guarantees a pasted link can never land on a list with a panel over it. `Open full detail`
inside the drawer navigates to the page, Daily Pulse links point at the page, and the
legacy `?opportunity=` address redirects to the page with `replace` so the dead address
does not linger in history.

Both the drawer and the page render one shared `<OpportunityDetail>`, so the disclosures
cannot drift apart: assessment, ownership and operator attribution, provisional
classification, timing caveat, the three confidence axes, the score breakdown, evidence
and publisher counts, access mode, capability list, and the local preview actions.

### 14.3 Decision-status claims were overstated

See §3.3. **D16 / ADR 0009**, **D19 / ADR 0006** and **D17 / ADR 0010** were presented as
approved. D16, D19 and D17 are **Open**; all three ADRs are **Proposed**. **ADR 0005** is
**Accepted in part** — the D18 time-bounded-ownership corollary only. Only **ADR 0004
(D15)** and **ADR 0012 (D24)** among the decisions this milestone touches are fully
Accepted.

The interface still displays the three confidence axes and the access mode, because
following a proposed default on illustrative fixture data is legitimate. What is not
legitimate is describing it as ratified, and the notes no longer do.

`13_GATE_1_DECISION_PACKET.md` was not modified.

### 14.4 What this pass deliberately did not do

No roadmap PR 2 surface was implemented — `/accounts`, `/accounts/:id`,
`/facilities/:id`, `/evidence/:id`, `/admin/health` and `/views` render placeholders built
from the established `UnavailableState`. No real pilot-account name, no PACK EXPO data, no
network call, no database, no migration, no authentication, no connector, no model call,
no vendor selection, and no new visual dependency.

---

## 15. Roadmap PR 2 — the five remaining surfaces (v2.0)

The five Phase 1 surfaces that PR 1 left as placeholders are implemented against fixtures,
and epic **E-A5** (responsive and accessibility validation) is completed across all seven.

### 15.1 What each surface is for

**Company — `/accounts`, `/accounts/:accountId`.** The list is a scanning surface: who,
what role, how many sites, how many open opportunities, coverage, and when it last moved.
The detail page is organised around an **as-at date**, because ADR 0005's accepted
corollary is that relationships are time-bounded, which means "who owns this" and "who
operates this site" have no answer until you say *when*. The date lives in the URL, so a
shared link reproduces the same attribution instead of silently re-resolving to today.

**Facility — `/facilities/:facilityId`.** A contextual surface with no navigation entry,
always reached from a company, an opportunity or an evidence record, and always showing
where it was reached from. Two distinctions carry the page: candidate versus confirmed
resolution, and company-level versus site-level events.

**Evidence detail — `/evidence/:evidenceId`.** Provenance with publication and retrieval
as separate values, content or an explicit withheld state, stated timing at its recorded
precision, source facts separated from system inferences, and correction relationships.

**Source Health & Coverage — `/admin/health`.** Two panels that are never merged.

**Saved Pursuits & Watches — `/views`.** Saved views, watched records, and rename/delete
affordances that are local to the preview session and say so.

### 15.2 The rules each surface had to keep honest

**Half-open intervals `[from, to)` — ADR 0005, accepted in part via D18.** `fromDate` is
inclusive, `toDate` is **exclusive**. The exclusivity is the whole point: a relationship
ending on the same date another begins produces neither an overlap nor a gap, so asking
"who owned this on the handover date" returns exactly one answer. An inclusive upper bound
would return two. `src/lib/ownership.ts` implements this and `src/test/ownership.test.ts`
tests the boundary from both sides.

The resolution ladder in ADR 0005 is still **Proposed** pending Gate G-4 and is **not**
implemented. Only the ownership corollary is.

**A demerger is not a clean termination.** The fixture history has three relationship rows
for one company: two parent edges and a retained `minority_interest`. Recording only the
ended parent edge would assert a complete separation that did not happen and would lose a
holding large enough to matter commercially. The interface shows ended relationships
rather than hiding them, and prints the interval notation — `[2027-06-30, ∞)` — so the
convention is visible rather than implied.

**A company milestone is not a facility event.** The operational-separation entry is
`scope: 'organization'` with `facilityId: null`. It appears on the company timeline and
not on any facility timeline, and the facility page says where such events live. No fixture
evidence states that any individual site changed hands, and writing one row per plant would
manufacture that claim once per plant.

**A date is never rendered finer than the source stated it — ADR 0004 / D15, Accepted.**
A record published in a month renders as that month with "(month precision)"; a record
dated to a year renders as the year. Rendering either as the first of the period asserts a
precision the publisher did not give.

**Corrections supersede — ADR 0012 / D24, Accepted.** The superseded record stays readable,
carries a "Superseded, not replaced" notice, and links to the record that replaced it; the
replacement links back. Nothing is deleted; what changes is only which record the presented
view selects.

**Health is not coverage — ADR 0010, Proposed / D17, Open.** Two panels, each stating its
own question, and a leading notice for the case the ADR exists for: four of six connectors
healthy while four companies sit below expected coverage. Gaps are **named**, not counted,
and each carries a plain-language reason. **No coverage measurement policy or threshold is
defined here** — D17 is open and this surface does not pre-empt it.

**Failures survive recovery.** A recovered connector keeps its failed runs in its history,
styled as failures. A health trend that silently rewrites itself cannot be trusted.

**Provisional classifications are excluded from relevance metrics — D11, approved
provisionally.** The account list states which population its denominator counted: three
count toward relevance metrics and three are provisionally classified and excluded.

### 15.3 What is deliberately unavailable

**D14-L** blocks the trade-show attendance import, the engagement layer, tier attributes
and `account_strategy` scoring pending an external licence review that has not concluded.
Target tier, engagement and the account-strategy score are therefore modelled as
`UnavailableAttribute` — an interface with **no value member at all**, so no fixture author
can fill one in "just for the demo". They render as "Not available" with the reason and the
blocker. `src/test/boundaries.test.ts` asserts the shape.

**The research-claim staging queue is not built.** Plan §11.2 scopes Source Health &
Coverage to two panels and staging is not one of them. An evidence record that references a
staged claim names it and does **not** link it, because offering a link to a page that does
not exist is worse than naming the reference plainly.

**Saved views have no owner.** D8 (ownership of tier changes and overrides) is **open**, so
the surface models no ownership, sharing, assignment or approval. Adding an owner field now
would encode an answer to a question that has not been decided.

**Nothing persists.** Renames and deletions live in React state for the life of the tab. No
`localStorage`, no request, no storage of any kind — and the surface says so at the top
rather than letting a reviewer infer durability from a control that appears to work.

### 15.4 Two changes to merged surfaces

Both are additive and both carry regression tests in
`src/test/mergedSurfaceRegression.test.tsx`.

**A visually hidden `<h2>` inside two result lists.** Card titles are `<h3>`, so the
document jumped `h1 → h3` and left a screen-reader user navigating by heading with no
anchor for the list. The heading is `visually-hidden`, so the approved layout is unchanged.
Applied to Opportunities and to the new Company list for consistency.

**An `empty` branch on the full-page opportunity detail.** The page handled loading,
unavailable, degraded and stale but not empty, so `?state=empty` rendered a back link and
nothing else. "No opportunities to open" is distinct from "No such opportunity": the first
means nothing has been ranked, the second means the set exists and this id is not in it.

### 15.5 An id is an address, not a name

Related-record links originally rendered the identifier — `fac-fixture-3` where a plant
belongs. That asks a business-development user to memorise the key space, which is the
opposite of what a related-records list is for. A reference now travels as a `RecordRef`
carrying the label and one line of context; the id remains the address and the `title`
attribute. `src/test/sevenSurfaces.test.tsx` asserts that no fixture identifier appears as
visible text on any record surface.

### 15.6 E-A5 — responsive and accessibility validation

Run across all seven surfaces, not sampled.

- One `main` landmark and exactly one `h1` per surface; no skipped heading levels.
- Every icon `aria-hidden`; every status pill carries a text label; every control has an
  accessible name.
- The skip link is the first tab stop everywhere; content is reachable by tabbing.
- Narrow viewport renders the bottom navigation on every surface.
- Driven in a real browser at **320 / 390 / 768 / 1024 / 1440 px**: no horizontal overflow
  on any of the nine routes, and a visible focus ring on every tab stop.

Two genuine overflows were found this way and fixed, both with CSS-contract regression
tests:

1. **Daily Pulse at 320 px** — a `1fr` grid column sized by its content rather than by the
   container pushed the review button past the viewport edge. Fixed with `minmax(0, 1fr)`
   and `min-width: 0`; the button now takes its own row when the label no longer fits.
2. **Source Health at 320 px** — the connector name and its state pill were a rigid
   `space-between` row. Fixed by letting the head wrap.

The as-at date field reports four tab stops with no accessible name in a naive audit. That
is Chromium splitting one native `<input type="date">` into shadow-DOM segments; the
control itself is labelled "Attribution as at" and carries the standard focus ring.

Contrast is asserted against the token file in CI for both themes. Eleven new colour
pairings introduced by these surfaces were added to that list; every one clears 4.5:1 in
light and dark.

### 15.7 Verification

Clean `npm ci`, strict typecheck, ESLint with zero warnings, **485 tests across 22 files**,
production build, and the boundary suite green — including the real-name check, which
forced the trade show to be described by what D14-L blocks rather than named.

### 15.8 What this milestone deliberately did not do

No Market Trends, Map or Briefings. No migration, infrastructure, D2b vendor selection,
authentication, model call, connector, or production data. No API-backed `DataSource`. No
new dependency of any kind — D10 is open, so every surface composes the existing token
scale, palette and radius family. No decision status was changed, and
`13_GATE_1_DECISION_PACKET.md` was not modified.
