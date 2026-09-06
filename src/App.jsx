import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || '').toLowerCase()
const GRAB_URL = import.meta.env.VITE_GRAB_URL || 'https://duckduckgo.com/?q={q}'

const TYPES = ['movie', 'show', 'album']

const STATUS_LABEL = {
  requested: 'on the list',
  grabbed: 'grabbing it',
  imported: { movie: 'ready to watch', show: 'ready to watch', album: 'ready to listen' },
}

function statusLabel(r) {
  const l = STATUS_LABEL[r.status]
  return typeof l === 'string' ? l : l[r.type]
}

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  return session ? <Queue session={session} /> : <SignIn />
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
      <form onSubmit={submit} className="stub stub-signin">
        <label>
          email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'one sec' : 'sign in'}</button>
      </form>
    </main>
  )
}

function Queue({ session }) {
  const isAdmin = (session.user.email || '').toLowerCase() === ADMIN_EMAIL
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('media_requests')
      .select('*')
      .order('created_at', { ascending: false })
    setRows(data || [])
  }

  useEffect(() => {
    load()
    const ch = supabase
      .channel('media_requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'media_requests' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  const visible = useMemo(() => {
    const list = filter === 'all' ? rows : rows.filter((r) => r.type === filter)
    const rank = { requested: 0, grabbed: 1, imported: 2 }
    return [...list].sort((a, b) => rank[a.status] - rank[b.status] || (a.created_at < b.created_at ? 1 : -1))
  }, [rows, filter])

  async function setStatus(id, status) {
    await supabase.from('media_requests').update({ status }).eq('id', id)
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
        <button className="primary" onClick={() => setAdding(true)}>+ request</button>
      </div>

      {adding && <AddForm user={session.user} onDone={() => setAdding(false)} />}

      {visible.length === 0 && !adding && (
        <p className="empty">nothing on the list. tap + request to add something.</p>
      )}

      <ul className="stubs">
        {visible.map((r) => (
          <li key={r.id} className={'stub ' + r.status}>
            {r.poster_url ? <img className="poster" src={r.poster_url} alt="" /> : <div className="poster blank" />}
            <div className="body">
              <div className="title">{r.title}{r.year ? <span className="year"> {r.year}</span> : null}</div>
              {r.artist && <div className="sub">{r.artist}</div>}
              {r.note && <div className="note">{r.note}</div>}
              <div className="meta">
                <span className="kind">{r.type}</span>
                <span className={'stamp ' + r.status}>{statusLabel(r)}</span>
              </div>
              {isAdmin && r.status !== 'imported' && (
                <div className="actions">
                  <a className="btn" href={GRAB_URL.replace('{q}', encodeURIComponent([r.artist, r.title, r.year].filter(Boolean).join(' ')))} target="_blank" rel="noreferrer">grab</a>
                  {r.status === 'requested' && <button className="btn" onClick={() => setStatus(r.id, 'grabbed')}>grabbed</button>}
                  <button className="btn" onClick={() => setStatus(r.id, 'imported')}>imported</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}

function AddForm({ user, onDone }) {
  const [type, setType] = useState('movie')
  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const [artist, setArtist] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.from('media_requests').insert({
      type,
      title: title.trim(),
      year: year ? Number(year) : null,
      artist: type === 'album' ? artist.trim() || null : null,
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
        {type === 'album' ? 'album' : 'title'}
        <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </label>
      {type === 'album' && (
        <label>
          artist
          <input value={artist} onChange={(e) => setArtist(e.target.value)} />
        </label>
      )}
      <label>
        year, if you know it
        <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      </label>
      <label>
        anything else
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="the one with ryan gosling" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>{busy ? 'adding' : 'add to the list'}</button>
        <button type="button" className="link" onClick={onDone}>cancel</button>
      </div>
    </form>
  )
}
