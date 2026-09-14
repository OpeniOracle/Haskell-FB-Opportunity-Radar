import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { IllustrativeNote } from '@/components/Illustrative'
import {
  DegradedNotice,
  EmptyState,
  LoadingState,
  StaleNotice,
  UnavailableState,
} from '@/components/SurfaceStates'
import { useDataSource } from '@/data/DataSourceContext'
import { useSurfaceData } from '@/hooks/useSurfaceData'
import { absoluteDateTime } from '@/lib/format'
import { MAX_PRIMARY_WIDGETS, dashboardUrlProblem, isApprovedEmbedUrl } from '@/lib/spyglass'
import type { SpyglassSnapshot, SpyglassWidget } from '@/types/domain'

/**
 * Spyglass media intelligence — `/media`.
 *
 * ONE DISTINCTION RUNS THROUGH THIS ENTIRE SURFACE: the dashboard is LIVE and
 * the embeds are NOT.
 *
 * Zignal's documentation is explicit that embeddable widgets support neither
 * realtime nor data refresh — an embed shows the data that existed when the
 * snippet was generated, permanently. So every frame on this page is labelled
 * "Snapshot generated <date>", the word "live" appears only on the link that
 * opens Zignal itself, and `snapshotGeneratedAt` is NOT NULL in the schema so a
 * widget that cannot say when it was frozen cannot exist. A month-old sentiment
 * chart presented as current coverage of a client's brand is worse than no
 * chart at all, and it is the specific thing this page is built not to do.
 *
 * SPYGLASS FAILING MUST NEVER TAKE ANYTHING ELSE DOWN. It is one surface reading
 * its own tables through the same state envelope as everything else; a Zignal
 * outage, a blocked frame or an unconfigured deployment is a condition rendered
 * HERE, and the Radar's own data is untouched by all three.
 */
export function Spyglass() {
  const source = useDataSource()
  const load = useCallback(() => source.getSpyglass(), [source])
  const state = useSurfaceData(load, [load])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">Spyglass media intelligence</h1>
          <p className="page-head__sub">
            Coverage of the monitored accounts, from Openi Spyglass. The dashboard is
            live; the snapshots below are not, and each one says when it was taken.
          </p>
        </div>
        {/* The preview build marks every surface that renders illustrative
            records. Production has no fixtures to mark, and this renders
            nothing there. */}
        <div className="page-head__meta">
          <IllustrativeNote />
        </div>
      </header>

      {state.kind === 'loading' && (
        <LoadingState label="Loading Spyglass media intelligence" rows={2} />
      )}

      {state.kind === 'empty' && (
        <EmptyState
          title="Spyglass is not configured yet"
          body={state.reason}
          next="An application administrator can set the dashboard address from this page."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="Spyglass isn’t available"
          reason={state.reason}
          blockedBy={state.blockedBy}
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'degraded' && (
        <DegradedNotice
          notice={state.notice}
          affected={state.affected}
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'stale' && (
        <StaleNotice notice={state.notice} asOf={state.asOf} checkedAt={state.checkedAt} />
      )}

      {/*
        A RELOAD AFTER SAVING, DELIBERATELY.

        The surface reads its state once; there is no refetch hook, and adding
        one for a control an administrator touches a few times a year would be
        plumbing in search of a use. A reload also guarantees that what is on
        screen afterwards is what the DATABASE holds rather than what the form
        believes it sent — which matters here more than usual, because a write
        this page cannot perform succeeds silently at the API and is caught by a
        row count.
      */}
      {hasData && <SpyglassBody snapshot={state.data} onSaved={() => window.location.reload()} />}
    </>
  )
}

function SpyglassBody({
  snapshot,
  onSaved,
}: {
  snapshot: SpyglassSnapshot
  onSaved: () => void
}) {
  const approved = snapshot.widgets.filter((w) => isApprovedEmbedUrl(w.embedUrl))
  const primary = approved.slice(0, MAX_PRIMARY_WIDGETS)
  const additional = approved.slice(MAX_PRIMARY_WIDGETS)

  return (
    <>
      <section className="spyglass-hero">
        <div className="spyglass-hero__body">
          <h2 className="spyglass-hero__title">{snapshot.settings.dashboardLabel}</h2>
          <p className="spyglass-hero__note">
            Opens Zignal in a new tab. This is the only place on this page showing current
            data — everything below is a snapshot.
          </p>
        </div>
        <a
          className="btn btn--primary spyglass-hero__action"
          href={snapshot.settings.dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open live dashboard
          {/* The destination is named, and the new-tab behaviour is announced
              rather than left for a screen-reader user to discover. */}
          <span className="visually-hidden">
            {' '}
            — external Spyglass destination, opens in a new tab
          </span>
          <Icon name="chevron" className="btn__icon" />
        </a>
      </section>

      {snapshot.viewerIsAdministrator && (
        <DashboardEditor
          current={snapshot.settings.dashboardUrl}
          label={snapshot.settings.dashboardLabel}
          onSaved={onSaved}
        />
      )}

      {approved.length === 0 ? (
        <EmptyState
          title="No snapshots are configured"
          body="No Zignal widget embed has been reviewed and added for this deployment. The live dashboard above is unaffected."
          next="Generate an embed snippet from the dashboard, then add its address here."
          checkedAt={null}
        />
      ) : (
        <>
          <section className="section" aria-labelledby="snapshots-title">
            <div className="section__head">
              <h2 className="section__title" id="snapshots-title">
                Snapshots
              </h2>
              <span className="section__count">{primary.length}</span>
              <span className="section__note">
                Frozen when generated — not live
              </span>
            </div>
            <div className="spyglass-grid">
              {primary.map((widget) => (
                <WidgetFrame
                  key={widget.id}
                  widget={widget}
                  dashboardUrl={snapshot.settings.dashboardUrl}
                />
              ))}
            </div>
          </section>

          {additional.length > 0 && (
            <section className="section" aria-labelledby="more-snapshots-title">
              <details>
                <summary className="section__title" id="more-snapshots-title">
                  {additional.length} further {additional.length === 1 ? 'snapshot' : 'snapshots'}
                </summary>
                <div className="spyglass-grid">
                  {additional.map((widget) => (
                    <WidgetFrame
                      key={widget.id}
                      widget={widget}
                      dashboardUrl={snapshot.settings.dashboardUrl}
                    />
                  ))}
                </div>
              </details>
            </section>
          )}
        </>
      )}

      {/*
        THE BOUNDARY, WRITTEN ON THE PAGE RATHER THAN ONLY IN A DOCUMENT.

        Somebody will eventually ask why a mention on this page did not become an
        opportunity. The answer is that an embedded chart is a picture: the
        Radar holds no rows behind it, cannot cite it, and will not derive
        anything from it. Saying so here is cheaper than saying it once the
        assumption has been made.
      */}
      <p className="notice notice--info spyglass-boundary">
        <Icon name="alert" className="notice__icon" />
        <span>
          <strong>Spyglass is not evidence. </strong>
          Nothing on this page is ingested, cited or turned into an opportunity. Media
          coverage reaches the Radar only through a reviewed CSV import, which is
          specified in <code>docs/spyglass-csv-ingestion.md</code> and not built yet.
        </span>
      </p>
    </>
  )
}

/**
 * One embedded snapshot.
 *
 * Lazy, because a third-party frame that loads before anyone scrolls to it costs
 * the page its first paint for content nobody has asked for yet. `loading="lazy"`
 * plus an IntersectionObserver gate, so the frame is not even in the document
 * until it is near the viewport.
 *
 * The fallback matters more than the frame. Framing fails for reasons entirely
 * outside this application — third-party cookies, an expired Zignal session, a
 * corporate proxy, `X-Frame-Options` — and every one of them produces the same
 * blank rectangle. A blank rectangle in a client demonstration is worse than a
 * link, so after a grace period an unloaded frame is replaced by one.
 */
function WidgetFrame({
  widget,
  dashboardUrl,
}: {
  widget: SpyglassWidget
  dashboardUrl: string
}) {
  const container = useRef<HTMLDivElement | null>(null)
  const [near, setNear] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const node = container.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!near || loaded) return
    /* A frame that has not fired `load` in this time is not going to. `onError`
       does not fire for a frame refused by `X-Frame-Options`, so a timer is the
       only signal there is. */
    const timer = window.setTimeout(() => setFailed(true), 8000)
    return () => window.clearTimeout(timer)
  }, [near, loaded])

  const generated = absoluteDateTime(widget.snapshotGeneratedAt)

  return (
    <article className="spyglass-card" ref={container}>
      <div className="spyglass-card__head">
        <h3 className="spyglass-card__title">{widget.title}</h3>
        {/* Prominent, not a footnote. This is the fact that stops the chart
            being read as current. */}
        <p className="spyglass-card__asof">
          <Icon name="clock" className="opp__meta-icon" />
          Snapshot generated {generated}
        </p>
      </div>

      <div className="spyglass-card__frame">
        {!near && (
          <p className="spyglass-card__loading" role="status">
            Snapshot loads when it scrolls into view.
          </p>
        )}

        {near && !loaded && !failed && (
          <p className="spyglass-card__loading" role="status" aria-live="polite">
            Loading the {widget.title} snapshot…
          </p>
        )}

        {near && !failed && (
          <iframe
            className={`spyglass-card__iframe${loaded ? '' : ' spyglass-card__iframe--pending'}`}
            src={widget.embedUrl}
            title={`${widget.title} — Spyglass snapshot generated ${generated}`}
            loading="lazy"
            /* No scripts, no forms, no top-level navigation from a third-party
               frame. `allow-same-origin` is absent, so the frame gets an opaque
               origin and cannot reach this page's storage. */
            sandbox=""
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}

        {failed && (
          <div className="spyglass-card__fallback" role="status">
            <Icon name="alert" className="notice__icon" />
            <p>
              <strong>This snapshot could not be displayed. </strong>
              Framing may be blocked by the browser, a network policy, or your Zignal
              session. Nothing else on the Radar is affected.
            </p>
            <a
              className="btn btn--quiet"
              href={widget.fallbackUrl || dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open live dashboard instead
              <Icon name="chevron" className="btn__icon" />
            </a>
          </div>
        )}
      </div>
    </article>
  )
}

/**
 * Repointing the dashboard, without a deployment.
 *
 * Rendered only for an administrator, and that is a CONVENIENCE rather than a
 * control: the row-level policy in migration 0024 is what refuses a write, and
 * it refuses it whether or not this form was rendered. A non-administrator who
 * forces the request gets a refusal from the database, and `setSpyglassDashboard`
 * reports it — a policy-filtered update succeeds while changing nothing, which
 * would otherwise be reported as saved.
 */
function DashboardEditor({
  current,
  label,
  onSaved,
}: {
  current: string
  label: string
  onSaved: () => void
}) {
  const source = useDataSource()
  const [url, setUrl] = useState(current)
  const [name, setName] = useState(label)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const problem = dashboardUrlProblem(url)

  return (
    <details className="spyglass-editor">
      <summary className="spyglass-editor__summary">
        <Icon name="settings" className="nav__icon" />
        Change the Spyglass dashboard
      </summary>
      <form
        className="spyglass-editor__form"
        onSubmit={async (event) => {
          event.preventDefault()
          if (problem) {
            setMessage({ tone: 'bad', text: problem })
            return
          }
          setSaving(true)
          const result = await source.setSpyglassDashboard(url.trim(), name.trim())
          setSaving(false)
          if (result.ok) {
            setMessage({ tone: 'ok', text: 'Saved. The dashboard link now points here.' })
            onSaved()
          } else {
            setMessage({ tone: 'bad', text: result.reason ?? 'The change was not saved.' })
          }
        }}
      >
        <label className="field">
          <span className="field__label">Dashboard address</span>
          <input
            className="filters__input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-describedby="spyglass-url-help"
            aria-invalid={problem ? true : undefined}
          />
        </label>
        <p className="field__help" id="spyglass-url-help">
          Must be an https address on zign.al or app.zignallabs.com.
        </p>

        <label className="field">
          <span className="field__label">Label</span>
          <input
            className="filters__input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save dashboard address'}
        </button>

        {message && (
          <p
            className={`notice ${message.tone === 'ok' ? 'notice--info' : 'notice--degraded'}`}
            role="status"
          >
            {message.text}
          </p>
        )}
      </form>
    </details>
  )
}
