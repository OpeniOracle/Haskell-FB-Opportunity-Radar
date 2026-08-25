import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon, type IconName } from '@/components/Icon'
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
import { absoluteDateTime, relativeTime } from '@/lib/format'
import { companyPath, facilityPath } from '@/lib/links'
import { opportunityDetailPath } from '@/lib/opportunityFilters'
import type { SavedViewRecord, SavedWorkspace, WatchItem } from '@/types/domain'

const WATCH_ICON: Record<WatchItem['kind'], IconName> = {
  company: 'building',
  facility: 'pin',
  opportunity: 'target',
}

const WATCH_LABEL: Record<WatchItem['kind'], string> = {
  company: 'Company',
  facility: 'Facility',
  opportunity: 'Opportunity',
}

const SURFACE_LABEL: Record<SavedViewRecord['surface'], string> = {
  opportunities: 'Opportunities',
  accounts: 'Company',
}

/**
 * Saved Pursuits & Watches — `/views`.
 *
 * Everything here is **local preview mechanics**. Renames and removals live in
 * React state for the life of the tab: no `localStorage`, no request, no
 * persistence of any kind. The surface says so at the top rather than letting a
 * reviewer infer durability from a control that appears to work.
 *
 * D8 (who may change an account's tier, and how overrides are governed) is
 * **Open**, so nothing here models ownership, sharing, assignment, approval or
 * collaboration. A view has a name, a surface, a filter summary and a count —
 * and no owner. Adding an owner field now would encode an answer to a question
 * that has not been decided.
 */
export function SavedViews() {
  const source = useDataSource()
  const load = useCallback(() => source.getSavedWorkspace(), [source])
  const state = useSurfaceData(load, [load])

  const hasData =
    state.kind === 'ready' || state.kind === 'degraded' || state.kind === 'stale'

  return (
    <>
      <header className="page-head page-head--tight">
        <div>
          <h1 className="page-head__title">Saved Pursuits &amp; Watches</h1>
          <p className="page-head__sub">
            The searches worth repeating and the records worth following.
          </p>
        </div>
        <div className="page-head__meta">
          <IllustrativeNote />
        </div>
      </header>

      {state.kind === 'loading' && <LoadingState label="Loading saved work" rows={2} />}

      {state.kind === 'empty' && (
        <EmptyState
          title="Nothing saved yet"
          body={state.reason}
          next="Save a filtered search from Opportunities or Company, and it appears here."
          checkedAt={state.checkedAt}
        />
      )}

      {state.kind === 'unavailable' && (
        <UnavailableState
          title="Saved work isn’t available"
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

      {hasData && <SavedWorkspaceBody workspace={state.data} />}
    </>
  )
}

function SavedWorkspaceBody({ workspace }: { workspace: SavedWorkspace }) {
  const { search } = useLocation()

  // Local session state only. Seeded from the fixture, discarded on reload —
  // which is exactly what the notice below promises.
  const [views, setViews] = useState(workspace.views)
  const [watches, setWatches] = useState(workspace.watches)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    setViews(workspace.views)
    setWatches(workspace.watches)
  }, [workspace])

  const renameView = (id: string, name: string) => {
    setViews((current) =>
      current.map((view) => (view.id === id ? { ...view, name } : view)),
    )
  }

  const removeView = (id: string) => {
    const removed = views.find((view) => view.id === id)
    setViews((current) => current.filter((view) => view.id !== id))
    if (removed) setAnnouncement(`Removed the saved view “${removed.name}” for this session.`)
  }

  const removeWatch = (id: string) => {
    const removed = watches.find((watch) => watch.id === id)
    setWatches((current) => current.filter((watch) => watch.id !== id))
    if (removed) setAnnouncement(`Stopped watching ${removed.label} for this session.`)
  }

  const restore = () => {
    setViews(workspace.views)
    setWatches(workspace.watches)
    setAnnouncement('Restored the illustrative saved views and watches.')
  }

  const changed =
    views.length !== workspace.views.length ||
    watches.length !== workspace.watches.length ||
    views.some((view, index) => view.name !== workspace.views[index]?.name)

  return (
    <>
      <p className="notice notice--info">
        <Icon name="flask" className="notice__icon" />
        <span>
          <strong>Changes are not saved outside this preview session. </strong>
          Renaming or removing an item below changes what you see now and nothing
          else. There is no storage behind this screen — reloading the page brings
          back the illustrative set exactly as it was.
        </span>
      </p>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      <section className="section" aria-labelledby="saved-views">
        <div className="section__head">
          <h2 className="section__title" id="saved-views">
            Saved views
          </h2>
          <span className="section__count">{views.length}</span>
          {changed && (
            <button type="button" className="btn btn--quiet" onClick={restore}>
              <Icon name="refresh" className="btn__icon" />
              Restore the illustrative set
            </button>
          )}
        </div>

        {views.length === 0 ? (
          <EmptyState
            title="No saved views in this session"
            body="Every saved view has been removed for the life of this tab."
            next="Reload the page, or use “Restore the illustrative set” above, to bring them back."
            checkedAt={null}
          />
        ) : (
          <ul className="saved-list">
            {views.map((view) => (
              <SavedViewCard
                key={view.id}
                view={view}
                search={search}
                onRename={renameView}
                onRemove={removeView}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="watched-records">
        <div className="section__head">
          <h2 className="section__title" id="watched-records">
            Watched records
          </h2>
          <span className="section__count">{watches.length}</span>
        </div>

        {watches.length === 0 ? (
          <EmptyState
            title="Nothing is being watched in this session"
            body="Every watch has been removed for the life of this tab."
            next="Reload the page to bring the illustrative watches back."
            checkedAt={null}
          />
        ) : (
          <ul className="saved-list">
            {watches.map((watch) => (
              <li className="saved-card" key={watch.id}>
                <div className="saved-card__body">
                  <p className="saved-card__eyebrow">
                    <Icon name={WATCH_ICON[watch.kind]} className="saved-card__icon" />
                    {WATCH_LABEL[watch.kind]}
                    <span className="opp__sep" aria-hidden="true">
                      •
                    </span>
                    <span title={absoluteDateTime(watch.addedAt)}>
                      Watching since {relativeTime(watch.addedAt)}
                    </span>
                  </p>
                  <h3 className="saved-card__title">
                    <Link to={watchPath(watch, search)}>{watch.label}</Link>
                  </h3>
                  <p className="saved-card__note">{watch.context}</p>
                </div>
                <div className="saved-card__actions">
                  <Link className="btn btn--quiet" to={watchPath(watch, search)}>
                    Open record
                    <Icon name="chevron" className="btn__icon" />
                  </Link>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => removeWatch(watch.id)}
                  >
                    Stop watching
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="drawer__prose drawer__prose--small">
        Saved views carry a name, the surface they belong to and the filters they
        represent — and nothing else. <strong>D8</strong> (ownership of tier changes
        and overrides) is <strong>open</strong>, so this surface does not model an
        owner, a shared state, an assignee or an approval step. Those belong to a
        decision that has not been made.
      </p>
    </>
  )
}

function watchPath(watch: WatchItem, search: string): string {
  if (watch.kind === 'company') return companyPath(watch.targetId, search)
  if (watch.kind === 'facility') return facilityPath(watch.targetId, search)
  return opportunityDetailPath(watch.targetId, search)
}

function SavedViewCard({
  view,
  search,
  onRename,
  onRemove,
}: {
  view: SavedViewRecord
  search: string
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(view.name)

  const commit = () => {
    const next = draft.trim()
    if (next) onRename(view.id, next)
    else setDraft(view.name)
    setEditing(false)
  }

  const destination =
    view.surface === 'accounts' ? '/accounts' : '/opportunities'

  return (
    <li className="saved-card">
      <div className="saved-card__body">
        <p className="saved-card__eyebrow">
          <Icon
            name={view.surface === 'accounts' ? 'building' : 'target'}
            className="saved-card__icon"
          />
          {SURFACE_LABEL[view.surface]}
          <span className="opp__sep" aria-hidden="true">
            •
          </span>
          <span title={absoluteDateTime(view.createdAt)}>
            Saved {relativeTime(view.createdAt)}
          </span>
        </p>

        {editing ? (
          <form
            className="saved-card__rename"
            onSubmit={(event) => {
              event.preventDefault()
              commit()
            }}
          >
            <label className="field">
              <span className="visually-hidden">Rename “{view.name}”</span>
              <input
                className="filters__input"
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setDraft(view.name)
                    setEditing(false)
                  }
                }}
              />
            </label>
            <button type="submit" className="btn btn--primary">
              Save name
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setDraft(view.name)
                setEditing(false)
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <h3 className="saved-card__title">
            <Link to={destination + search}>{view.name}</Link>
          </h3>
        )}

        <ul className="saved-card__filters">
          {view.filterSummary.map((entry) => (
            <li className="saved-card__filter" key={entry}>
              {entry}
            </li>
          ))}
        </ul>
        <p className="saved-card__note">
          {view.resultCount} {view.resultCount === 1 ? 'record' : 'records'} matched
          when this view was saved. The count is not recomputed here — opening the
          view runs the filters again.
        </p>
      </div>

      <div className="saved-card__actions">
        <Link className="btn btn--primary" to={destination + search}>
          Open view
          <Icon name="chevron" className="btn__icon" />
        </Link>
        {!editing && (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              setDraft(view.name)
              setEditing(true)
            }}
          >
            Rename
          </button>
        )}
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => onRemove(view.id)}
        >
          Delete
        </button>
      </div>
    </li>
  )
}
