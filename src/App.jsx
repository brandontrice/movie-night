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

function Feed({ session }) {
  const isAdmin = (session.user.email || '').toLowerCase() === ADMIN_EMAIL
  const [rows, setRows] = useState([])
  const [events, setEvents] = useState([])
  const [profiles, setProfiles] = useState({})
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(false)
  const [type, setType] = useState('movie')
  const [scanning, setScanning] = useState({})
  const [thud, setThud] = useState({})
  const seen = useRef(null)
  const prevStatus = useRef({})

  async function load() {
    const [r, e] = await Promise.all([
      supabase.from('media_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('media_events').select('*').order('at'),
    ])
    const list = r.data || []
    // first load: everything is "seen"; later loads: new ids get the tear-in
    if (seen.current === null) seen.current = new Set(list.map((x) => x.id))
    // stamp thud on any status change
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

  const visible = filter === 'all' ? rows : rows.filter((r) => r.type === filter)
  const who = (uid) => profiles[uid]?.display_name || 'someone'

  function openForm() {
    setType(filter === 'all' ? 'movie' : filter)
    setAdding(true)
  }

  async function setStatus(id, status) {
    await supabase.from('media_requests').update({ status }).eq('id', id)
  }

  async function markImported(id) {
    setScanning((s) => ({ ...s, [id]: true }))
    const { error } = await supabase.functions.invoke('library-scan', { body: { id } })
    if (error) await setStatus(id, 'imported')
    setScanning((s) => ({ ...s, [id]: false }))
  }

  const counts = useMemo(() => {
    const c = { all: rows.length }
    for (const t of TYPES) c[t] = rows.filter((r) => r.type === t).length
    return c
  }, [rows])

  const waiting = rows.filter((r) => r.status !== 'imported').length
  const ready = rows.length - waiting

  return (
    <main className="queue">
      <Marquee>
        <h1 className="marquee">movie night</h1>
        <p className="tagline">{rows.length === 0 ? 'nothing on the list yet' : `${waiting} waiting, ${ready} ready`}</p>
      </Marquee>

      {/* one row of chips: filters the feed, or picks the type while adding */}
      <div className={'chips ticketrow' + (adding ? ' picking' : '')} role="tablist">
        {!adding && (
          <button role="tab" aria-selected={filter === 'all'} className={'chip' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>
            everything
          </button>
        )}
        {TYPES.map((t) => {
          const on = adding ? type === t : filter === t
          return (
            <button key={t} role="tab" aria-selected={on} className={'chip' + (on ? ' on' : '')} onClick={() => (adding ? setType(t) : setFilter(t))}>
              {adding ? t : t + 's'}{!adding && counts[t] ? <span className="count">{counts[t]}</span> : null}
            </button>
          )
        })}
      </div>

      {adding && <AddForm user={session.user} type={type} listed={new Set(rows.filter((r) => r.type === type && r.external_id).map((r) => r.external_id))} onDone={() => setAdding(false)} />}

      {visible.length === 0 && !adding && (
        <div className="empty">
          <div className="ticket-ghost" aria-hidden="true" />
          <p>{filter === 'all' ? 'the list is empty. ask for something.' : `no ${filter}s on the list yet.`}</p>
        </div>
      )}

      <ul className="stubs">
        {visible.map((r) => {
          const trail = trailFor[r.id] || []
          const first = trail[0]
          const p = profiles[r.requested_by]
          const isNew = seen.current && !seen.current.has(r.id)
          if (isNew) seen.current.add(r.id)
          return (
            <li key={r.id} className={'stub ' + r.status + (isNew ? ' tear' : '')}>
              {r.poster_url ? <img className="poster" src={r.poster_url} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <div className="poster blank" />}
              <div className="body">
                <div className="byline">
                  <span className="dot" style={{ background: p?.color || '#999' }} />
                  <span>{who(r.requested_by)}</span>
                  <span className="when">{timeAgo(first?.at || r.created_at)}</span>
                  <span className="kind">{r.type}</span>
                </div>
                <div className="title">{r.title}{r.year ? <span className="year"> {r.year}</span> : null}</div>
                {r.artist && <div className="sub">{r.artist}</div>}
                {r.note && <div className="note">{r.note}</div>}

                {trail.length > 1 && (
                  <ol className="trail">
                    {trail.slice(1).map((ev) => (
                      <li key={ev.id} className={ev.event}>
                        {TRAIL[ev.event](who(ev.actor), r)}
                        <span className="when">{timeAgo(ev.at)}</span>
                      </li>
                    ))}
                  </ol>
                )}

                <div className="meta">
                  {r.status === 'imported' && r.play_url ? (
                    <a className={'stamp imported' + (thud[r.id] ? ' thud' : '')} href={r.play_url} target="_blank" rel="noreferrer">{READY[r.type]}, play it</a>
                  ) : (
                    <span className={'stamp ' + r.status + (thud[r.id] ? ' thud' : '')}>
                      {r.status === 'imported' ? READY[r.type] : r.status === 'grabbed' ? 'grabbing it' : 'on the list'}
                    </span>
                  )}
                </div>

                {isAdmin && r.status !== 'imported' && (
                  <div className="actions">
                    <a className="btn" href={GRAB_URL.replace('{q}', encodeURIComponent([r.artist, r.title, r.year].filter(Boolean).join(' ')))} target="_blank" rel="noreferrer">grab</a>
                    {r.status === 'requested' && <button className="btn" onClick={() => setStatus(r.id, 'grabbed')}>grabbed</button>}
                    <button className={'btn' + (scanning[r.id] ? ' busy' : '')} disabled={!!scanning[r.id]} onClick={() => markImported(r.id)}>
                      {scanning[r.id] ? 'scanning the shelf' : 'imported'}
                    </button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {!adding && (
        <button className="fab" onClick={openForm} aria-label="request something">
          <span className="plus">+</span> request
        </button>
      )}

      <footer className="foot">
        <button className="link" onClick={() => supabase.auth.signOut()}>sign out</button>
      </footer>
    </main>
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
