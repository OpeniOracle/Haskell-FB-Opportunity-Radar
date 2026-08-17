# 16 — Phase 1 PR 1 Implementation Notes

**Status:** Implemented, pending visual review
**Scope:** Phase 1 PR 1 — fixture-backed application shell
**Milestone plan:** `docs/design/15_PHASE_1_IMPLEMENTATION_PLAN.md`
**Version:** 1.0

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

Production bundle: **205 kB raw / 65 kB gzipped JS**, **24 kB raw / 5 kB gzipped
CSS**.

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
export type SurfaceState<T> =
  | { kind: 'loading' }
  | { kind: 'empty'; reason: string }
  | { kind: 'unavailable'; reason: string; blockedBy: string }
  | { kind: 'degraded'; data: T; notice: string; affected: string[] }
  | { kind: 'stale'; data: T; notice: string; asOf: string }
  | { kind: 'ready'; data: T }
```

Non-happy states are part of the type, so a surface cannot render a happy path for
data that is degraded or stale by forgetting to check a flag. Note the deliberate
asymmetry: `empty` and `unavailable` carry no data and replace the content;
`degraded` and `stale` carry data and sit *above* content that is still worth
reading. A notice that hides what it qualifies is worse than no notice.

### 3.3 Approved decisions encoded structurally

| Decision | How it is encoded |
|---|---|
| D15 / ADR 0004 — temporal precision | `TemporalValue` is an interval with `precision` and `basis`. There is no bare `Date` field in `domain.ts`. `formatTemporal()` renders at the recorded precision and prefers the source's own words. |
| D16 / ADR 0009 — three confidence axes | `ConfidenceAxes` has `evidenceStrength`, `assessmentType`, `confidenceLevel` as separate fields. The card renders them separately; a test asserts the guardrails hold across every fixture. |
| D11 — scope classification | `OrganizationRef.scopeClassStatus` is `'provisional' \| 'confirmed'`. A provisional classification renders a visible "Provisional classification" indicator. |
| ADR 0006 — evidence access modes | `EvidenceSummary.strongestAccessMode` is shown on every card, and the `reference_only` fixture demonstrates the resulting confidence ceiling. |
| ADR 0010 — health vs coverage | Daily Pulse shows account coverage and connector health as two independent figures with explanatory copy. They are never merged into one health number. |

---

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

Seven surfaces: five primary navigation entries plus two contextual routes,
matching §3 of the Phase 1 plan.

| Route | Placement | Status |
|---|---|---|
| `/` — Daily Pulse | Primary | **Implemented** |
| `/opportunities` — Opportunities | Primary | **Implemented** |
| `/accounts` — Accounts | Primary | Placeholder |
| `/trends` — Trends | Primary | Placeholder |
| `/operations` — Operations | Primary | Placeholder |
| `/opportunities/:opportunityId` — Opportunity detail | Contextual | Placeholder |
| `/accounts/:accountId` — Account detail | Contextual | Placeholder |

Every route is wired and reachable. Placeholders name the milestone they belong to
and list what the surface will do, so "not built yet" is visibly different from
"broken". `*` renders an explicit not-found state rather than redirecting, because
a silent redirect hides the mistake.

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
