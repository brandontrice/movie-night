import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || '').toLowerCase()
const GRAB_URL = import.meta.env.VITE_GRAB_URL || 'https://duckduckgo.com/?q={q}'
const TYPES = ['movie', 'show', 'album']

const READY = { movie: 'ready to watch', show: 'ready to watch', album: 'ready to listen' }
const TRAIL = {
  requested: (who) => `${who} asked for it`,
  grabbed: (who) => `${who} grabbed it`,
  imported: (who, r) => READY[r.type],
  watched: (who) => `${who} watched it`,
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 7) return `${Math.floor(d)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* the sign over the door: a ring of bulbs that chase on, then twinkle */
function Marquee({ children }) {
  const bulbs = useMemo(() => Array.from({ length: 34 }, (_, i) => i), [])
  return (
    <div className="board">
      <div className="bulbs" aria-hidden="true">
        {bulbs.map((i) => <span key={i} className="bulb" style={{ '--i': i }} />)}
      </div>
      <div className="board-inner">{children}</div>
      <div className="valance" aria-hidden="true" />
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  if (session === undefined) return null
  return session ? <Feed session={session} /> : <SignIn />
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('that email and password did not match')
    setBusy(false)
  }
  return (
    <main className="signin">
      <Marquee>
        <h1 className="marquee">movie night</h1>
        <p className="tagline">tell brandon what to grab next</p>
      </Marquee>
      <form onSubmit={submit} className="stub stub-form tear">
        <label>email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
        <label>password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'one sec' : 'sign in'}</button>
      </form>
    </main>
  )
}

const NINETY_DAYS = 90 * 24 * 3600 * 1000
const PAGE = 20

function Feed({ session }) {
  const isAdmin = (session.user.email || '').toLowerCase() === ADMIN_EMAIL
  const [rows, setRows] = useState([])
  const [events, setEvents] = useState([])
  const [profiles, setProfiles] = useState({})
  const [adding, setAdding] = useState(false)
  const [type, setType] = useState('movie')
  const [scanning, setScanning] = useState({})
  const [thud, setThud] = useState({})
  const [open, setOpen] = useState(null)
  const [lineAll, setLineAll] = useState(false)
  const [shelfQ, setShelfQ] = useState('')
  const [shelfType, setShelfType] = useState('all')
  const [shelfOlder, setShelfOlder] = useState(false)
  const [shelfPage, setShelfPage] = useState(1)
  const detailCache = useRef({})
  const seen = useRef(null)
  const prevStatus = useRef({})

  async function load() {
    const [r, e] = await Promise.all([
      supabase.from('media_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('media_events').select('*').order('at'),
    ])
    const list = r.data || []
    if (seen.current === null) seen.current = new Set(list.map((x) => x.id))
    const changed = {}
    for (const x of list) {
      const was = prevStatus.current[x.id]
      if (was && was !== x.status) changed[x.id] = true
      prevStatus.current[x.id] = x.status
    }
    if (Object.keys(changed).length) {
      setThud((t) => ({ ...t, ...changed }))
      setTimeout(() => setThud((t) => { const n = { ...t }; for (const k in changed) delete n[k]; return n }), 900)
    }
    setRows(list)
    setEvents(e.data || [])
  }

  useEffect(() => {
    supabase.from('profiles').select('*').then(({ data }) => {
      const map = {}
      for (const p of data || []) map[p.user_id] = p
      setProfiles(map)
    })
    load()
    const ch = supabase
      .channel('movie-night')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'media_requests' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'media_events' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  const trailFor = useMemo(() => {
    const by = {}
    for (const ev of events) (by[ev.request_id] ||= []).push(ev)
    return by
  }, [events])

  const who = (uid) => profiles[uid]?.display_name || 'someone'

  // the three populations
  const pending = useMemo(() => rows.filter((r) => r.status !== 'imported'), [rows])
  const waiting = pending.filter((r) => r.status === 'requested')
  const grabbing = pending.filter((r) => r.status === 'grabbed')
  const ready = useMemo(
    () => rows.filter((r) => r.status === 'imported').sort((a, b) => (b.imported_at || b.created_at).localeCompare(a.imported_at || a.created_at)),
    [rows]
  )
  const nowShowing = ready.slice(0, 8)
  const justAdded = useMemo(() => {
    const by = {}
    for (const t of TYPES) by[t] = ready.filter((r) => r.type === t).slice(0, 3)
    return by
  }, [ready])
  const shelf = useMemo(() => {
    const cutoff = Date.now() - NINETY_DAYS
    const q = shelfQ.trim().toLowerCase()
    return ready.filter((r) =>
      (shelfType === 'all' || r.type === shelfType) &&
      (shelfOlder || new Date(r.imported_at || r.created_at).getTime() >= cutoff) &&
      (!q || r.title.toLowerCase().includes(q) || (r.artist || '').toLowerCase().includes(q))
    )
  }, [ready, shelfQ, shelfType, shelfOlder])
  const olderCount = useMemo(() => {
    const cutoff = Date.now() - NINETY_DAYS
    return ready.filter((r) => new Date(r.imported_at || r.created_at).getTime() < cutoff).length
  }, [ready])

  async function setStatus(id, status) {
    await supabase.from('media_requests').update({ status }).eq('id', id)
  }
  async function markImported(id) {
    setScanning((s) => ({ ...s, [id]: true }))
    const { error } = await supabase.functions.invoke('library-scan', { body: { id } })
    if (error) await setStatus(id, 'imported')
    setScanning((s) => ({ ...s, [id]: false }))
  }
  function openForm() { setAdding(true) }

  const lineRows = lineAll ? [...waiting, ...grabbing] : [...waiting, ...grabbing].slice(0, 5)
  const openRow = open ? rows.find((r) => r.id === open.id) || open : null

  function Row({ r }) {
    const p = profiles[r.requested_by]
    const isNew = seen.current && !seen.current.has(r.id)
    if (isNew) seen.current.add(r.id)
    return (
      <li className={'row ' + r.status + (isNew ? ' tear' : '')} onClick={(e) => { if (!e.target.closest('a,button')) setOpen(r) }}>
        <span className="dot" style={{ background: p?.color || '#999' }} />
        <span className="row-who">{who(r.requested_by)}</span>
        <span className="row-title">{r.title}{r.year ? <span className="year"> {r.year}</span> : null}{r.artist ? <span className="year"> · {r.artist}</span> : null}</span>
        <span className="row-when">{timeAgo(r.created_at)}</span>
        {r.status === 'grabbed' && <span className={'badge grabbed' + (thud[r.id] ? ' thud' : '')}>grabbing</span>}
        {isAdmin && (
          <span className="row-actions">
            <a className="icon" title="grab" href={GRAB_URL.replace('{q}', encodeURIComponent([r.artist, r.title, r.year].filter(Boolean).join(' ')))} target="_blank" rel="noreferrer">↗</a>
            {r.status === 'requested'
              ? <button className="btn tiny" onClick={() => setStatus(r.id, 'grabbed')}>grabbed</button>
              : <button className={'btn tiny' + (scanning[r.id] ? ' busy' : '')} disabled={!!scanning[r.id]} onClick={() => markImported(r.id)}>{scanning[r.id] ? 'scanning' : 'imported'}</button>}
          </span>
        )}
      </li>
    )
  }

  return (
    <main className="queue">
      <Marquee>
        <h1 className="marquee">movie night</h1>
        <p className="tagline">
          {rows.length === 0 ? 'nothing on the list yet' : `${waiting.length} in line, ${grabbing.length} grabbing, ${ready.length} ready`}
        </p>
      </Marquee>

      {adding && (
        <>
          <div className="chips ticketrow picking" role="tablist">
            {TYPES.map((t) => (
              <button key={t} role="tab" aria-selected={type === t} className={'chip' + (type === t ? ' on' : '')} onClick={() => setType(t)}>{t}</button>
            ))}
          </div>
          <AddForm user={session.user} type={type} listed={new Set(rows.filter((r) => r.type === type && r.external_id).map((r) => r.external_id))} onDone={() => setAdding(false)} />
        </>
      )}

      <div className="layout">
        <div className="col-main">
          {/* now showing */}
          <section className="block">
            <h2 className="h">now showing</h2>
            {nowShowing.length === 0 ? (
              <p className="hint dim">nothing ready yet. the first thing brandon imports lands here.</p>
            ) : (
              <ul className="rail">
                {nowShowing.map((r, i) => (
                  <li key={r.id} className={i === 0 ? 'lead' : ''}>
                    <a href={r.play_url || '#'} onClick={(e) => { if (!r.play_url) { e.preventDefault(); setOpen(r) } }} target={r.play_url ? '_blank' : undefined} rel="noreferrer">
                      {r.poster_url ? <img src={r.poster_url} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="poster blank" />}
                      <span className="rail-title">{r.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* the line */}
          <section className="block">
            <h2 className="h">the line <span className="count">{pending.length}</span></h2>
            {pending.length === 0 ? (
              <p className="hint dim">nothing waiting. ask for something.</p>
            ) : (
              <ul className="line">
                {lineRows.map((r) => <Row key={r.id} r={r} />)}
              </ul>
            )}
            {pending.length > 5 && (
              <button className="link" onClick={() => setLineAll((v) => !v)}>{lineAll ? 'show fewer' : `see all ${pending.length}`}</button>
            )}
          </section>

          {/* just added (mobile position) */}
          <section className="block rail-mobile">
            <JustAdded justAdded={justAdded} onOpen={setOpen} />
          </section>

          {/* the shelf */}
          <section className="block">
            <h2 className="h">the shelf</h2>
            <div className="shelf-tools">
              <input value={shelfQ} onChange={(e) => { setShelfQ(e.target.value); setShelfPage(1) }} placeholder="search what's been imported" />
              <div className="chips">
                {['all', ...TYPES].map((t) => (
                  <button key={t} className={'chip' + (shelfType === t ? ' on' : '')} onClick={() => { setShelfType(t); setShelfPage(1) }}>{t === 'all' ? 'everything' : t + 's'}</button>
                ))}
              </div>
            </div>
            {shelf.length === 0 ? (
              <p className="hint dim">{ready.length === 0 ? 'nothing imported yet' : 'nothing matches'}</p>
            ) : (
              <ul className="shelf">
                {shelf.slice(0, shelfPage * PAGE).map((r) => (
                  <li key={r.id} className="row imported" onClick={(e) => { if (!e.target.closest('a,button')) setOpen(r) }}>
                    {r.poster_url ? <img className="thumb" src={r.poster_url} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="thumb blank" />}
                    <span className="row-title">{r.title}{r.year ? <span className="year"> {r.year}</span> : null}{r.artist ? <span className="year"> · {r.artist}</span> : null}</span>
                    <span className="row-when">{timeAgo(r.imported_at || r.created_at)}</span>
                    {r.play_url && <a className="btn tiny" href={r.play_url} target="_blank" rel="noreferrer">play</a>}
                  </li>
                ))}
              </ul>
            )}
            <div className="actions">
              {shelf.length > shelfPage * PAGE && <button className="btn" onClick={() => setShelfPage((p) => p + 1)}>load more</button>}
              {olderCount > 0 && <button className="link" onClick={() => { setShelfOlder((v) => !v); setShelfPage(1) }}>{shelfOlder ? 'hide older than 90 days' : `show ${olderCount} older`}</button>}
            </div>
          </section>
        </div>

        <aside className="col-rail rail-desktop">
          <JustAdded justAdded={justAdded} onOpen={setOpen} />
        </aside>
      </div>

      {!adding && (
        <button className="fab" onClick={openForm} aria-label="request something">
          <span className="plus">+</span> request
        </button>
      )}

      {openRow && (
        <Sheet
          row={openRow}
          trail={trailFor[openRow.id] || []}
          who={who}
          cache={detailCache}
          isAdmin={isAdmin}
          scanning={!!scanning[openRow.id]}
          onGrabbed={() => setStatus(openRow.id, 'grabbed')}
          onImported={() => markImported(openRow.id)}
          onClose={() => setOpen(null)}
        />
      )}

      <footer className="foot">
        <button className="link" onClick={() => supabase.auth.signOut()}>sign out</button>
      </footer>
    </main>
  )
}

function JustAdded({ justAdded, onOpen }) {
  const any = TYPES.some((t) => justAdded[t].length)
  return (
    <div className="just-added">
      <h2 className="h">just added</h2>
      {!any && <p className="hint dim">nothing yet</p>}
      {TYPES.map((t) => justAdded[t].length > 0 && (
        <div key={t} className="ja-group">
          <div className="ja-type">{t}s</div>
          <ul>
            {justAdded[t].map((r) => (
              <li key={r.id}>
                <button className="ja-item" onClick={() => onOpen(r)}>
                  {r.poster_url ? <img src={r.poster_url} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="thumb blank" />}
                  <span className="ja-title">{r.title}</span>
                  <span className="when">{timeAgo(r.imported_at || r.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function Sheet({ row, trail, who, cache, isAdmin, scanning, onGrabbed, onImported, onClose }) {
  const [d, setD] = useState(cache.current[row.id] ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  useEffect(() => {
    if (d || !row.external_id) return
    supabase.functions.invoke('details', { body: { type: row.type, external_id: row.external_id } }).then(({ data, error }) => {
      if (error || !data || data.error) return setFailed(true)
      cache.current[row.id] = data
      setD(data)
    })
  }, [row.id])

  const metaBits = d ? [
    d.year,
    d.runtime ? `${d.runtime} min` : null,
    d.seasons ? `${d.seasons} season${d.seasons === 1 ? '' : 's'}` : null,
    d.rating,
    d.score ? `${d.score}/10` : null,
    d.label,
  ].filter(Boolean) : []

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hero" style={d?.backdrop_url ? { backgroundImage: `url(${d.backdrop_url})` } : undefined}>
          <button className="sheet-close" onClick={onClose} aria-label="close">close</button>
          {(d?.poster_url || row.poster_url) && <img className="sheet-poster" src={d?.poster_url || row.poster_url} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
          <div className="sheet-titles">
            <h2>{row.title}</h2>
            {row.artist && <div className="sheet-sub">{row.artist}</div>}
            {d?.tagline && <div className="sheet-tag">{d.tagline}</div>}
          </div>
        </div>

        <div className="sheet-body">
          {metaBits.length > 0 && <p className="sheet-meta">{metaBits.join(' / ')}</p>}
          {d?.genres?.length > 0 && (
            <div className="chips small">{d.genres.map((g) => <span key={g} className="chip static">{g}</span>)}</div>
          )}
          {d?.overview && <p className="sheet-overview">{d.overview}</p>}
          {d?.director && row.type !== 'album' && <p className="sheet-line"><span>directed by</span> {d.director}</p>}
          {d?.cast?.length > 0 && (
            <p className="sheet-line"><span>with</span> {d.cast.map((c) => c.name).join(', ')}</p>
          )}
          {d?.tracks?.length > 0 && (
            <ol className="tracks">
              {d.tracks.map((t) => (
                <li key={t.n}><span className="n">{t.n}</span>{t.title}{t.length && <span className="len">{t.length}</span>}</li>
              ))}
            </ol>
          )}
          {!d && !failed && row.external_id && <ul className="results skeleton" aria-hidden="true"><li /><li /></ul>}
          {!d && (failed || !row.external_id) && <p className="hint">no extra details for this one</p>}
          {row.note && <p className="note">{row.note}</p>}

          <ol className="trail">
            {trail.map((ev) => (
              <li key={ev.id} className={ev.event}>
                {TRAIL[ev.event](who(ev.actor), row)}
                <span className="when">{timeAgo(ev.at)}</span>
              </li>
            ))}
          </ol>

          <div className="actions">
            {row.status === 'imported' && row.play_url ? (
              <a className="primary" href={row.play_url} target="_blank" rel="noreferrer">{READY[row.type]}, play it</a>
            ) : row.status === 'imported' ? (
              <span className="stamp imported">{READY[row.type]}</span>
            ) : isAdmin ? (
              <>
                <a className="btn" href={GRAB_URL.replace('{q}', encodeURIComponent([row.artist, row.title, row.year].filter(Boolean).join(' ')))} target="_blank" rel="noreferrer">grab</a>
                {row.status === 'requested' && <button className="btn" onClick={onGrabbed}>grabbed</button>}
                <button className={'btn' + (scanning ? ' busy' : '')} disabled={scanning} onClick={onImported}>{scanning ? 'scanning the shelf' : 'imported'}</button>
              </>
            ) : (
              <span className={'stamp ' + row.status}>{row.status === 'grabbed' ? 'grabbing it' : 'on the list'}</span>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function AddForm({ user, type, listed, onDone }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState({ candidates: [], owned: [] })
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [looking, setLooking] = useState(false)
  const [toast, setToast] = useState(null)
  const timer = useRef()
  const toastTimer = useRef()

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  useEffect(() => {
    clearTimeout(timer.current)
    if (q.trim().length < 2) return setResults({ candidates: [], owned: [] })
    timer.current = setTimeout(async () => {
      setLooking(true)
      const { data } = await supabase.functions.invoke('lookup', { body: { q: q.trim(), type } })
      setResults(data || { candidates: [], owned: [] })
      setLooking(false)
    }, 350)
    return () => clearTimeout(timer.current)
  }, [q, type])

  // tapping a result adds it straight away
  async function add(row) {
    if (busy || !row.title) return
    setBusy(true)
    setError('')
    const { error } = await supabase.from('media_requests').insert({
      type,
      title: row.title,
      year: row.year ? Number(row.year) : null,
      artist: row.artist ?? null,
      poster_url: row.poster_url ?? null,
      external_id: row.external_id ?? null,
      note: note.trim() || null,
      requested_by: user.id,
    })
    setBusy(false)
    if (error) return setError(error.code === '23505' ? "that's already on the list" : 'could not add that, try again')
    // stay here: drop the one we added, keep the rest, say so
    setResults((r) => ({ ...r, candidates: r.candidates.filter((c) => c.external_id !== row.external_id || !row.external_id) }))
    if (!row.external_id) setQ('')
    setNote('')
    setShowNote(false)
    clearTimeout(toastTimer.current)
    setToast(`added ${row.title}`)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }

  const noMatches = !looking && q.trim().length >= 2 && results.candidates.length === 0

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (noMatches) add({ title: q.trim() }) }} className={'stub stub-form tear' + (busy ? ' adding' : '')}>
      <label>
        {type === 'album' ? 'album or artist' : 'title'}
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder={type === 'album' ? 'continuum' : type === 'show' ? 'the bear' : 'the notebook'} />
      </label>

      {showNote ? (
        <label>
          anything else
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="the one with ryan gosling" autoFocus />
        </label>
      ) : (
        <button type="button" className="link tiny" onClick={() => setShowNote(true)}>add a note</button>
      )}

      {results.owned.length > 0 && (
        <div className="owned">
          <div>already on the shelf</div>
          {results.owned.map((o) => (
            <a key={o.play_url} href={o.play_url} target="_blank" rel="noreferrer">
              {o.title}{o.year ? ` (${o.year})` : ''}{o.artist ? `, ${o.artist}` : ''}, play it
            </a>
          ))}
        </div>
      )}

      {looking && (
        <ul className="results skeleton" aria-hidden="true">
          <li /><li /><li />
        </ul>
      )}

      {!looking && results.candidates.length > 0 && (
        <>
          <p className="hint">tap one to add it</p>
          <ul className="results">
            {results.candidates.map((c, i) => (
              <li key={c.external_id} style={{ '--i': i }} className={listed.has(c.external_id) ? 'listed' : ''}>
                <button type="button" disabled={busy || listed.has(c.external_id)} onClick={() => add(c)}>
                  {c.poster_url ? <img src={c.poster_url} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="noposter" />}
                  <span>
                    <strong>{c.title}</strong>{c.year ? ` ${c.year}` : ''}
                    {c.artist && <em>{c.artist}</em>}
                  </span>
                  <span className="go">{listed.has(c.external_id) ? 'on the list' : 'add'}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {noMatches && (
        <div className="actions">
          <p className="hint">no matches for that</p>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'adding' : `add "${q.trim()}" anyway`}</button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={onDone}>done</button>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </form>
  )
}
