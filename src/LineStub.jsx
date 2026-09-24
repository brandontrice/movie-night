import { useEffect, useRef, useState } from 'react'
import { sized } from './lib/images'

const asked = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase()

/* one request in the line, as a ticket stub: the main part (poster, title, a quiet meta line) opens the detail
   sheet; the stub end, past the perforation, holds "admit one" or, when you can act on it, a "..." button that
   tears the stub open into a tray of actions. every state lives in the tray, so the row itself never crowds.

   leaving: 'shelf' (it just got imported: a stamp lands, then it folds away) or 'pulled' (taken off the list) */
export default function LineStub({
  r, isNew = false, thud = false, leaving = null,
  canImport = false, canPull = false,
  trayOpen = false, scanning = false, missed = false, pulling = false, slowAfter = 8000,
  onOpen, onToggleTray, onImported, onAskPull, onKeep, onPull,
}) {
  const hasActions = (canImport || canPull) && !leaving
  const moreRef = useRef(null)
  const trayRef = useRef(null)
  const trayId = `tray-${r.id}`

  // scans can take the best part of a minute while jellyfin looks; after a few seconds, say so
  const [slowFor, setSlowFor] = useState(null)  // which scan went long, so a new scan starts fresh
  const [scanId, setScanId] = useState(0)
  useEffect(() => {
    if (!scanning) return
    const id = Date.now()
    const t0 = setTimeout(() => setScanId(id), 0)
    const t = setTimeout(() => setSlowFor(id), slowAfter)
    return () => { clearTimeout(t0); clearTimeout(t) }
  }, [scanning, slowAfter])
  const slow = scanning && slowFor !== null && slowFor === scanId

  // opening: focus the first action and make sure the tray is on screen. it can grow the desktop sidebar past
  // what fits, which un-sticks it and moves it, so wait for that layout before scrolling to the tray
  const wasOpen = useRef(trayOpen)
  useEffect(() => {
    if (trayOpen && !wasOpen.current) {
      const t = trayRef.current
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!t) return
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
        t.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
        t.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
      }))
    }
    wasOpen.current = trayOpen
  }, [trayOpen])

  const onTrayKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onToggleTray?.(); moreRef.current?.focus() } }

  const album = r.type === 'album'
  const meta = [r.artist || r.year, r.artist ? r.year : null, r.type, `asked ${asked(r.created_at)}`].filter(Boolean)
  const cls = 'stub-row' + (isNew ? ' tear' : '') + (leaving ? ` leaving-${leaving}` : '') + (trayOpen ? ' open' : '') + (scanning ? ' scanning' : '')

  return (
    <li className={cls} aria-busy={scanning || undefined}>
      <div className={'ticket-stub' + (album ? ' album' : '')}>
        <button type="button" className="stub-main" onClick={() => onOpen?.(r)} aria-label={`${r.title}${r.year ? `, ${r.year}` : ''}, details`}>
          <span className="stub-thumb" aria-hidden="true">
            {r.poster_url
              ? <img src={sized(r.poster_url, 120)} alt="" width="40" height={album ? 40 : 60} loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
              : <span className="stub-thumb-blank" />}
          </span>
          <span className="stub-text">
            <span className="stub-title">{r.title}</span>
            <span className="stub-meta">{meta.join(' · ')}{r.note ? <em> · {r.note}</em> : null}</span>
          </span>
        </button>
        <span className="stub-end">
          {hasActions ? (
            <button
              ref={moreRef} type="button" className="stub-more" onClick={onToggleTray}
              aria-expanded={trayOpen} aria-controls={trayId} aria-label={`actions for ${r.title}`}
            >
              <span className="stub-dots" aria-hidden="true" />
            </button>
          ) : (
            <span className="stub-admit" aria-hidden="true">admit one</span>
          )}
        </span>
        {scanning && <span className="stub-beam" aria-hidden="true" />}
        {r.status === 'grabbed' && !leaving && <span className={'stamp grabbed stub-stamp' + (thud ? ' thud' : '')}>grabbing</span>}
        {leaving === 'shelf' && <span className="stamp imported thud stub-stamp">on the shelf</span>}
      </div>

      {trayOpen && hasActions && (
        <div className="stub-tray" id={trayId} ref={trayRef} role="group" aria-label={`actions for ${r.title}`} onKeyDown={onTrayKey}>
          {missed && !pulling && <p className="tray-note" role="status">not on the shelf yet. it'll move over by itself once it lands</p>}
          {pulling ? (
            <>
              <button type="button" className="btn tray-btn danger" onClick={onPull}>sure? take it off the list</button>
              <button type="button" className="btn tray-btn quiet" onClick={onKeep}>keep it</button>
            </>
          ) : (
            <>
              {canImport && (
                <button type="button" className={'btn tray-btn ink' + (scanning ? ' busy' : '')} disabled={scanning} onClick={onImported}>
                  {scanning ? (slow ? 'still looking, jellyfin can be slow' : 'scanning the shelf') : missed ? 'try again' : 'imported'}
                </button>
              )}
              {canPull && <button type="button" className="btn tray-btn quiet" disabled={scanning} onClick={onAskPull}>nevermind</button>}
            </>
          )}
        </div>
      )}
    </li>
  )
}

// the same stubs, blank, while the line is loading
export function StubSkeletons({ n = 3 }) {
  return Array.from({ length: n }, (_, i) => (
    <li key={i} className="stub-row skeleton" aria-hidden="true">
      <div className="ticket-stub">
        <span className="stub-main"><span className="stub-thumb" /><span className="stub-text"><span className="stub-title">&nbsp;</span><span className="stub-meta">&nbsp;</span></span></span>
        <span className="stub-end" />
      </div>
    </li>
  ))
}
