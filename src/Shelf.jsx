import { useEffect, useRef } from 'react'
import { sized } from './lib/images'
import { timeAgo, dayKey, dayLabel } from './lib/time'

const TYPES = ['movie', 'show', 'album']
const PLURAL = { all: 'everything', movie: 'movies', show: 'shows', album: 'albums' }
const added = (r) => r.imported_at || r.created_at

/* the shelf, set like a cinema's program: the tools on a small panel, then everything grouped under the day it
   arrived. each row is one line: the main part opens the detail sheet, "play" at the end is its own control.
   gold on the shelf means one thing: new since you last looked */
export function ShelfTools({ q, onQ, type, onType, counts, resultText }) {
  // on a narrow phone the strip scrolls sideways: keep the chosen tab in view so you can see what's on
  const tabs = useRef(null)
  useEffect(() => { tabs.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }) }, [type])
  return (
    <div className="shelf-tools">
      <label className="shelf-search">
        <span className="sr-only">search the shelf</span>
        <span className="search-glyph" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="search the shelf" enterKeyHint="search" autoComplete="off" />
        {q && <button type="button" className="search-clear" onClick={() => onQ('')} aria-label="clear search"><span aria-hidden="true" /></button>}
      </label>
      <div className="shelf-tabs" role="group" aria-label="show" ref={tabs}>
        {['all', ...TYPES].map((t) => (
          <button key={t} type="button" className="shelf-tab" aria-pressed={type === t} onClick={() => onType(t)}>
            {PLURAL[t]} <span className="tab-count">{counts[t] ?? 0}</span>
          </button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">{resultText}</p>
    </div>
  )
}

function ShelfRow({ r, fresh, forWhom, onOpen }) {
  const album = r.type === 'album'
  const meta = album ? [r.artist, r.year, 'album'] : [r.year, r.type]
  return (
    <li className={'shelf-row' + (fresh ? ' fresh' : '')}>
      <button type="button" className="shelf-main" onClick={() => onOpen(r)} aria-label={`${r.title}${r.year ? `, ${r.year}` : ''}, details${fresh ? ', new since your last visit' : ''}`}>
        <span className={'shelf-thumb' + (album ? ' album' : '')} aria-hidden="true">
          {r.poster_url
            ? <img src={sized(r.poster_url, 120)} alt="" width="40" height={album ? 40 : 60} loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            : <span className="stub-thumb-blank" />}
        </span>
        <span className="shelf-text">
          <span className="shelf-title">{r.title}</span>
          <span className="shelf-meta">
            {meta.filter(Boolean).join(' · ')}
            {forWhom && <span className="for" style={{ '--c': forWhom.color }}>{forWhom.label}</span>}
          </span>
        </span>
        <span className="shelf-when">{timeAgo(added(r))}</span>
      </button>
      {r.play_url
        ? <a className="shelf-play" href={r.play_url} target="_blank" rel="noreferrer" aria-label={`play ${r.title}`}>play</a>
        : <span className="shelf-play none" aria-hidden="true" />}
    </li>
  )
}

// the visible slice, broken into days. each day's count is for the whole filtered list, not just this page
export function ShelfList({ items, shown, freshKeys, forWhom, onOpen }) {
  const totals = {}
  for (const r of items) { const k = dayKey(added(r)); totals[k] = (totals[k] || 0) + 1 }
  const groups = []
  for (const r of items.slice(0, shown)) {
    const k = dayKey(added(r))
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, label: dayLabel(added(r)), rows: [] })
    groups[groups.length - 1].rows.push(r)
  }
  return groups.map((g) => (
    <div key={g.k} className="shelf-day">
      <h3 className="shelf-day-head"><span>{g.label}</span><span className="shelf-day-count">{totals[g.k]}</span></h3>
      <ul className="shelf">
        {g.rows.map((r) => <ShelfRow key={r.id} r={r} fresh={freshKeys.has(r.id)} forWhom={forWhom(r)} onOpen={onOpen} />)}
      </ul>
    </div>
  ))
}

export function ShelfSkeleton({ n = 6 }) {
  return (
    <div className="shelf-day" aria-hidden="true">
      <h3 className="shelf-day-head skeleton"><span>&nbsp;</span></h3>
      <ul className="shelf">
        {Array.from({ length: n }, (_, i) => (
          <li key={i} className="shelf-row skeleton">
            <span className="shelf-main"><span className="shelf-thumb" /><span className="shelf-text"><span className="shelf-title">&nbsp;</span><span className="shelf-meta">&nbsp;</span></span></span>
            <span className="shelf-play none" />
          </li>
        ))}
      </ul>
    </div>
  )
}

