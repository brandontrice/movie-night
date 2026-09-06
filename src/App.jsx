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
      <h1 className="marquee">movie night</h1>
      <p className="tagline">tell brandon what to grab next</p>
      <form onSubmit={submit} className="stub stub-form">
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
  const [scanning, setScanning] = useState({})

  async function load() {
    const [r, e] = await Promise.all([
      supabase.from('media_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('media_events').select('*').order('at'),
    ])
    setRows(r.data || [])
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

  async function setStatus(id, status) {
    await supabase.from('media_requests').update({ status }).eq('id', id)
  }

  async function markImported(id) {
    setScanning((s) => ({ ...s, [id]: true }))
    const { error } = await supabase.functions.invoke('library-scan', { body: { id } })
    if (error) await setStatus(id, 'imported') // scan failed; still flip the stamp
    setScanning((s) => ({ ...s, [id]: false }))
  }

  return (
    <main className="queue">
      <header className="top">
        <h1 className="marquee">movie night</h1>
        <button className="link" onClick={() => supabase.auth.signOut()}>sign out</button>
      </header>

      <div className="toolbar">
        <div className="chips" role="tablist">
          {['all', ...TYPES].map((t) => (
            <button key={t} role="tab" aria-selected={filter === t} className={'chip' + (filter === t ? ' on' : '')} onClick={() => setFilter(t)}>
              {t === 'all' ? 'everything' : t + 's'}
            </button>
          ))}
        </div>
        {!adding && <button className="primary" onClick={() => setAdding(true)}>+ request</button>}
      </div>

      {adding && <AddForm user={session.user} onDone={() => setAdding(false)} />}

      {visible.length === 0 && !adding && (
        <p className="empty">nothing on the list yet. tap + request to add something.</p>
      )}

      <ul className="stubs">
        {visible.map((r) => {
          const trail = trailFor[r.id] || []
          const first = trail[0]
          const p = profiles[r.requested_by]
          return (
            <li key={r.id} className={'stub ' + r.status}>
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

                <ol className="trail">
                  {trail.slice(1).map((ev) => (
                    <li key={ev.id} className={ev.event}>
                      {TRAIL[ev.event](who(ev.actor), r)}
                      <span className="when">{timeAgo(ev.at)}</span>
                    </li>
                  ))}
                </ol>

                <div className="meta">
                  {r.status === 'imported' && r.play_url ? (
                    <a className="stamp imported" href={r.play_url} target="_blank" rel="noreferrer">{READY[r.type]}, play it</a>
                  ) : r.status === 'imported' ? (
                    <span className="stamp imported">{READY[r.type]}</span>
                  ) : r.status === 'grabbed' ? (
                    <span className="stamp grabbed">grabbing it</span>
                  ) : (
                    <span className="stamp requested">on the list</span>
                  )}
                </div>

                {isAdmin && r.status !== 'imported' && (
                  <div className="actions">
                    <a className="btn" href={GRAB_URL.replace('{q}', encodeURIComponent([r.artist, r.title, r.year].filter(Boolean).join(' ')))} target="_blank" rel="noreferrer">grab</a>
                    {r.status === 'requested' && <button className="btn" onClick={() => setStatus(r.id, 'grabbed')}>grabbed</button>}
                    <button className="btn" disabled={!!scanning[r.id]} onClick={() => markImported(r.id)}>
                      {scanning[r.id] ? 'scanning the shelf' : 'imported'}
                    </button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}

function AddForm({ user, onDone }) {
  const [type, setType] = useState('movie')
  const [q, setQ] = useState('')
  const [results, setResults] = useState({ candidates: [], owned: [] })
  const [pick, setPick] = useState(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [looking, setLooking] = useState(false)
  const timer = useRef()

  useEffect(() => {
    setPick(null)
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

  async function submit(e) {
    e.preventDefault()
    const row = pick || { title: q.trim(), year: null, artist: null, poster_url: null, external_id: null }
    if (!row.title) return
    setBusy(true)
    setError('')
    const { error } = await supabase.from('media_requests').insert({
      type,
      title: row.title,
      year: row.year ? Number(row.year) : null,
      artist: row.artist,
      poster_url: row.poster_url,
      external_id: row.external_id,
      note: note.trim() || null,
      requested_by: user.id,
    })
    setBusy(false)
    if (error) return setError('could not add that, try again')
    onDone()
  }

  return (
    <form onSubmit={submit} className="stub stub-form">
      <div className="chips">
        {TYPES.map((t) => (
          <button type="button" key={t} className={'chip' + (type === t ? ' on' : '')} onClick={() => setType(t)}>{t}</button>
        ))}
      </div>

      <label>
        {type === 'album' ? 'album or artist' : 'title'}
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder={type === 'album' ? 'continuum' : 'the notebook'} />
      </label>

      {results.owned.length > 0 && !pick && (
        <div className="owned">
          <div>already on the shelf</div>
          {results.owned.map((o) => (
            <a key={o.play_url} href={o.play_url} target="_blank" rel="noreferrer">
              {o.title}{o.year ? ` (${o.year})` : ''}{o.artist ? `, ${o.artist}` : ''}, play it
            </a>
          ))}
        </div>
      )}

      {!pick && results.candidates.length > 0 && (
        <ul className="results">
          {results.candidates.map((c) => (
            <li key={c.external_id}>
              <button type="button" onClick={() => { setPick(c); setQ(c.title) }}>
                {c.poster_url ? <img src={c.poster_url} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="noposter" />}
                <span>
                  <strong>{c.title}</strong>{c.year ? ` ${c.year}` : ''}
                  {c.artist && <em>{c.artist}</em>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {looking && !pick && <p className="hint">looking</p>}
      {!looking && !pick && q.trim().length >= 2 && results.candidates.length === 0 && (
        <p className="hint">no matches, but you can still add it as typed</p>
      )}

      {pick && (
        <div className="picked">
          {pick.poster_url && <img src={pick.poster_url} alt="" />}
          <span><strong>{pick.title}</strong>{pick.year ? ` ${pick.year}` : ''}{pick.artist ? `, ${pick.artist}` : ''}</span>
          <button type="button" className="link" onClick={() => setPick(null)}>change</button>
        </div>
      )}

      <label>
        anything else
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="the one with ryan gosling" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || q.trim().length === 0}>{busy ? 'adding' : 'add to the list'}</button>
        <button type="button" className="link" onClick={onDone}>cancel</button>
      </div>
    </form>
  )
}
