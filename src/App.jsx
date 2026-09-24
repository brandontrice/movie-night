import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { art, sized } from './lib/images'
import PosterCase, { CaseSkeletons } from './PosterCase'
import { useMedia } from './lib/useMedia'

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || '').toLowerCase()
const TYPES = ['movie', 'show', 'album']
// localStorage can throw (private windows, blocked storage); the greeting just shows again next time
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* nothing to remember with */ } },
}

const READY = { movie: 'ready to watch', show: 'ready to watch', album: 'ready to listen' }
const TRAIL = {
  requested: (who) => `${who} asked for it`,
  grabbed: (who) => `${who} grabbed it`,
  imported: (who, r) => READY[r.type],
  watched: (who) => `${who} watched it`,
}

// the numbers under the sign: what's waiting, then what's on the shelf by type.
// two groups so a phone can stack them as two whole lines; the dots between bits are drawn by css,
// so a wrapped line never starts with one
function Tagline({ pending, ready }) {
  const n = { movie: 0, show: 0, album: 0 }
  for (const r of ready) if (r.type in n) n[r.type]++
  const shelf = TYPES.filter((t) => n[t]).map((t) => [n[t], `${t}${n[t] === 1 ? '' : 's'}`])
  const bit = ([num, label]) => <span key={label} className="tag-bit"><strong>{num}</strong> {label}</span>
  return (
    <p className="tagline">
      <span className="tag-rule" aria-hidden="true" />
      <span className="tag-bits">
        <span className="tag-group">{bit([pending, 'in line'])}</span>
        {shelf.length > 0 && <span className="tag-group">{shelf.map(bit)}</span>}
      </span>
      <span className="tag-rule" aria-hidden="true" />
    </p>
  )
}

// a section's board: the title, its ticket number, a gold rule out to the edge, and any links at the end
function SectionHead({ id, title, count, countTone, children }) {
  return (
    <div className="sec-head">
      <h2 className="sec-title" id={id}>{title}</h2>
      {count != null && <span className={'ticket-no' + (countTone ? ' ' + countTone : '')}>{count}</span>}
      <span className="sec-rule" aria-hidden="true" />
      {children && <span className="sec-links">{children}</span>}
    </div>
  )
}

// the house lights dim once per browser session, on the first load; after that the room is just dark
const HOUSE_KEY = 'movie-night:house-lights'
const HOUSE_LIGHTS = (() => {
  try {
    if (sessionStorage.getItem(HOUSE_KEY)) return false
    sessionStorage.setItem(HOUSE_KEY, 'dimmed')
    return true
  } catch { return false }
})()

// the room behind everything: light spilling from the sign, velvet in the margins, grain, a darker floor
function Room() {
  return <div className={'room' + (HOUSE_LIGHTS ? ' house-lights' : '')} aria-hidden="true" />
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

function when(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase()
}

// deterministic shuffle: the same seed gives the same order on every device (fnv-1a hash -> mulberry32)
function seededShuffle(list, seed) {
  let h = 2166136261
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  let st = h >>> 0
  const rand = () => {
    st = (st + 0x6d2b79f5) >>> 0
    let t = st
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/* the sign over the door: a ring of bulbs around a black-and-gold board that chase on, then keep chasing */
const TOP = 19, SIDE = 3
function Marquee({ children, sticky = false }) {
  // the full sign stays in the page and scrolls away like anything else. once it's gone, a slim copy fixed to the top
  // fades in. nothing here ever changes the page's height while you scroll: the old sticky sign shrank in place, the
  // page jumped by what it lost, and on a phone that yanked the scroll back under your finger (and on iOS, with the
  // greeting up, kept safari's toolbar from ever collapsing, so "got it" stayed hidden under it)
  const ref = useRef(null)
  const [bar, setBar] = useState(false)
  useEffect(() => {
    if (!sticky || !ref.current) return
    const io = new IntersectionObserver(([e]) => setBar(!e.isIntersecting), { rootMargin: '-80px 0px 0px 0px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [sticky])
  const bulbs = useMemo(() => {
    const out = []
    let n = 0
    const put = (x, y, side) => out.push({ i: n, x, y, side, p: n++ % 3 })
    for (let k = 0; k < TOP; k++) put((k + 0.5) / TOP * 100, 0, 't')             // across the top
    for (let k = 1; k <= SIDE; k++) put(100, k / (SIDE + 1) * 100, 'r')         // down the right
    for (let k = TOP - 1; k >= 0; k--) put((k + 0.5) / TOP * 100, 100, 'b')     // back along the bottom
    for (let k = SIDE; k >= 1; k--) put(0, k / (SIDE + 1) * 100, 'l')           // up the left
    return out
  }, [])
  const sign = (
    <>
      <div className="board-glow" aria-hidden="true" />
      <div className="board-inner">
        <div className="bulbs" aria-hidden="true">
          {bulbs.map((b) => <span key={b.i} className={'bulb ' + b.side} style={{ '--i': b.i, '--p': b.p, left: `${b.x}%`, top: `${b.y}%` }} />)}
        </div>
        <div className="board-face">{children}</div>
      </div>
      <div className="valance" aria-hidden="true" />
    </>
  )
  // the slim copy only repeats what the real header already says, so it's hidden from screen readers and inert.
  // in it only the bottom row of bulbs stays lit: a letterboard with a strip of lights under it
  return (
    <>
      <header ref={ref} className="board">{sign}</header>
      {sticky && <div className={'board compact bar' + (bar ? ' shown' : '')} aria-hidden="true" inert>{sign}</div>}
    </>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  return (
    <>
      <Room />
      {session === undefined ? null : session ? <Feed session={session} /> : <SignIn />}
    </>
  )
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
        <p className="tagline">put it on the marquee</p>
      </Marquee>
      <div className="ticket-wrap">
      <form onSubmit={submit} className="stub stub-form ticket tear" aria-label="sign in">
        <label>email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
        <label>password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'one sec' : 'sign in'}</button>
      </form>
      </div>
    </main>
  )
}

const NINETY_DAYS = 90 * 24 * 3600 * 1000
const RECENT = 72 * 3600 * 1000
const isRecent = (r) => Date.now() - new Date(r.imported_at || r.created_at).getTime() < RECENT
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
  const [lineAll, setLineAll] = useState({})
  const [shelfQ, setShelfQ] = useState('')
  const [shelfType, setShelfType] = useState('all')
  const [shelfOlder, setShelfOlder] = useState(false)
  const [shelfPage, setShelfPage] = useState(1)
  const [library, setLibrary] = useState([])
  const [libLoaded, setLibLoaded] = useState(false)
  const [libError, setLibError] = useState(false)
  const [rowsLoaded, setRowsLoaded] = useState(false)
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
    if (Object.values(changed).length && list.some((x) => changed[x.id] && x.status === 'imported')) loadLibrary()
    if (Object.keys(changed).length) {
      setThud((t) => ({ ...t, ...changed }))
      setTimeout(() => setThud((t) => { const n = { ...t }; for (const k in changed) delete n[k]; return n }), 900)
    }
    setRows(list)
    setEvents(e.data || [])
    setRowsLoaded(true)
  }

  async function loadLibrary() {
    const { data, error } = await supabase.functions.invoke('shelf', { body: {} })
    // a failed answer is not an empty shelf: keep what we had and say we couldn't reach the servers
    if (error || !data || data.error) { setLibError(true); setLibLoaded(true); return }
    setLibError(false)
    setLibrary((data.items || []).map((i) => ({ ...i, id: i.key, poster_url: art(i.poster_url), status: 'imported', imported_at: i.added_at, created_at: i.added_at, fromLibrary: true })))
    setLibLoaded(true)
  }
  function retryLibrary() { setLibError(false); setLibLoaded(false); loadLibrary() }

  useEffect(() => {
    loadLibrary()
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
  // what's actually on the servers, with the matching request attached when there is one
  const ready = useMemo(() => {
    const byItem = {}
    for (const r of rows) if (r.status === 'imported' && r.library_item_id) byItem[r.library_item_id] = r
    return library.map((i) => {
      const req = byItem[i.library_item_id]
      return req ? { ...i, requested_by: req.requested_by, note: req.note, request_id: req.id, external_id: i.external_id || req.external_id } : i
    })
  }, [library, rows])
  // now showing: a daily shuffle of what nobody's watched yet, same on every phone, reshuffle on demand.
  // topped up with watched titles only when the unwatched pool runs dry.
  const [roll, setRoll] = useState(0)
  const [railAll, setRailAll] = useState(false)
  const watchable = useMemo(() => ready.filter((r) => r.type !== 'album'), [ready])
  const unwatched = useMemo(() => watchable.filter((r) => !r.played), [watchable])
  const wide = useMedia('(min-width: 1024px)')
  const picksN = wide ? 13 : 8
  const nowShowing = useMemo(() => {
    const seed = `${new Date().toDateString()}:${roll}`
    const picks = seededShuffle(unwatched, seed)
    if (railAll || picks.length < picksN) picks.push(...seededShuffle(watchable.filter((r) => r.played), seed))
    return railAll ? picks : picks.slice(0, picksN)
  }, [unwatched, watchable, roll, railAll, picksN])
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

  // pulling a ticket: only while it's still just requested, only your own (brandon can pull any)
  const [pulling, setPulling] = useState({})
  const canPull = (r) => r.status === 'requested' && (isAdmin || r.requested_by === session.user.id)
  function askPull(id) {
    setPulling((p) => ({ ...p, [id]: true }))
    setTimeout(() => setPulling((p) => { const n = { ...p }; delete n[id]; return n }), 3500)
  }
  async function pull(id) {
    setPulling((p) => { const n = { ...p }; delete n[id]; return n })
    setOpen((o) => (o?.id === id ? null : o))
    await supabase.from('media_requests').delete().eq('id', id)
  }
  // "imported": scan, then only close the request if the item is really there. otherwise say so and leave it in line.
  const [missed, setMissed] = useState({})
  async function markImported(id) {
    setScanning((s) => ({ ...s, [id]: true }))
    const { data, error } = await supabase.functions.invoke('library-scan', { body: { id } })
    setScanning((s) => ({ ...s, [id]: false }))
    if (error || !data?.found) {
      setMissed((m) => ({ ...m, [id]: true }))
      setTimeout(() => setMissed((m) => { const n = { ...m }; delete n[id]; return n }), 4000)
    }
  }
  function openForm() { setAdding(true) }

  // the line splits into a column per person: whoever isn't brandon on the left, brandon on the right
  // something scanned straight into jellyfin or navidrome never went through a request, so no event names who did it.
  // only brandon imports, so credit him: his own id when he's the one looking, otherwise whoever the last import was credited to.
  const adder = isAdmin ? session.user.id : [...events].reverse().find((ev) => ev.event === 'imported')?.actor || null
  const arrivals = useArrivals(events, rows, ready, adder)
  const lineCols = useMemo(() => {
    const by = {}
    for (const r of pending) (by[r.requested_by] ||= []).push(r)
    return Object.keys(by).sort((a, b) => (a === adder) - (b === adder)).map((uid) => ({ uid, rows: by[uid] }))
  }, [pending, adder])
  // the mark you last left. frozen for this visit so the shelf stays lit while you look; advanced when you dismiss the greeting
  const seenAtMount = useRef(store.get(SEEN_KEY) || '')
  const isFresh = (a) => !seenAtMount.current || a.at > seenAtMount.current
  const freshKeys = useMemo(() => new Set(arrivals.filter(isFresh).map((a) => a.row.id)), [arrivals])
  const openRow = open ? (open.fromLibrary ? ready.find((r) => r.id === open.id) || open : rows.find((r) => r.id === open.id) || open) : null

  // the line sidebar (desktop) only sticks when all of it fits between the compact sign and the request button.
  // taller than that, it scrolls with the page like everything else, so no row is ever out of reach.
  const lineRef = useRef(null)
  const lineSticks = useFitsBelowSign(lineRef)

  // rows that turned up after the first load get the tear-in; each id only ever gets it once
  const newIds = useMemo(() => new Set(seen.current ? pending.filter((r) => !seen.current.has(r.id)).map((r) => r.id) : []), [pending])
  useEffect(() => { for (const id of newIds) seen.current?.add(id) }, [newIds])

  return (
    <main className="queue">
      <Marquee sticky>
        <h1 className="marquee">movie night</h1>
        {rows.length === 0 && ready.length === 0
          ? <p className="tagline">nothing on the list yet</p>
          : <Tagline pending={pending.length} ready={ready} />}
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
          {/* now showing */}
          <section className="block now" aria-labelledby="sec-now">
            <SectionHead id="sec-now" title="now showing" count={unwatched.length > 0 ? `${unwatched.length} unwatched` : null}>
              {watchable.length > 1 && <button className="sec-link" onClick={() => setRoll((n) => n + 1)}>reshuffle</button>}
              {watchable.length > picksN && <button className="sec-link" onClick={() => setRailAll((v) => !v)}>{railAll ? 'just a few' : `all ${watchable.length}`}</button>}
            </SectionHead>
            {libError && nowShowing.length === 0 ? (
              <div className="case-plaque error" role="alert">
                <p>couldn't reach the servers</p>
                <button className="btn more" onClick={retryLibrary}>try again</button>
              </div>
            ) : !libLoaded ? (
              <>
                <p className="sr-only" role="status">checking the shelf</p>
                <ul className="cases" aria-hidden="true"><CaseSkeletons n={picksN} /></ul>
              </>
            ) : nowShowing.length === 0 ? (
              <div className="case-plaque empty">
                <span className="case dark" aria-hidden="true"><span className="case-glass"><span className="case-mat" /></span></span>
                <p>nothing on the servers yet</p>
              </div>
            ) : (
              <ul className={'cases' + (railAll ? ' wall' : '')}>
                {nowShowing.map((r, i) => (
                  <li key={r.id} className={i === 0 ? 'lead' : ''}>
                    <PosterCase r={r} lead={i === 0} wall={railAll} index={i} onOpen={setOpen} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* the line */}
          <section className={'block line-block' + (lineSticks ? ' stick' : '')} aria-labelledby="sec-line" ref={lineRef}>
            <SectionHead id="sec-line" title="the line" count={pending.length} />
            {pending.length === 0 ? (
              <p className="hint dim">nothing waiting. ask for something.</p>
            ) : (
              <div className="line-cols">
                {lineCols.map(({ uid, rows: list }) => {
                  const all = !!lineAll[uid]
                  const p = profiles[uid]
                  return (
                    <div key={uid} className="line-col">
                      <h3 className="h sub">
                        <span className="dot" style={{ '--c': p?.color || '#999' }} />
                        {uid === session.user.id ? 'yours' : `${who(uid)}'s`}
                        <span className="count">{list.length}</span>
                      </h3>
                      <ul className="line">
                        {(all ? list : list.slice(0, 5)).map((r) => (
                          <LineRow
                            key={r.id} r={r} isNew={newIds.has(r.id)} thud={!!thud[r.id]} isAdmin={isAdmin}
                            scanning={!!scanning[r.id]} missed={!!missed[r.id]} canPull={canPull(r)} pulling={!!pulling[r.id]}
                            onOpen={setOpen} onImported={markImported} onAskPull={askPull} onPull={pull}
                          />
                        ))}
                      </ul>
                      {list.length > 5 && (
                        <button className="link more" onClick={() => setLineAll((v) => ({ ...v, [uid]: !all }))}>{all ? 'show fewer' : `see all ${list.length}`}</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* the shelf */}
          <section className="block shelf-block" aria-labelledby="sec-shelf">
            <SectionHead id="sec-shelf" title="the shelf" count={freshKeys.size > 0 ? `${freshKeys.size} new` : null} countTone="fresh" />
            <div className="shelf-tools">
              <input value={shelfQ} onChange={(e) => { setShelfQ(e.target.value); setShelfPage(1) }} placeholder="search what's been imported" />
              <div className="chips">
                {['all', ...TYPES].map((t) => (
                  <button key={t} className={'chip' + (shelfType === t ? ' on' : '')} onClick={() => { setShelfType(t); setShelfPage(1) }}>{t === 'all' ? 'everything' : t + 's'}</button>
                ))}
              </div>
            </div>
            {shelf.length === 0 ? (
              <p className="hint dim">{!libLoaded ? 'checking the shelf' : libError && ready.length === 0 ? "couldn't reach the servers" : ready.length === 0 ? 'nothing on the servers yet' : 'nothing matches'}</p>
            ) : (
              <ul className="shelf">
                {shelf.slice(0, shelfPage * PAGE).map((r) => (
                  <li key={r.id} className={'row imported' + (freshKeys.has(r.id) ? ' fresh' : '')} onClick={(e) => { if (!e.target.closest('a,button')) setOpen(r) }}>
                    {r.poster_url ? <img className="thumb" src={sized(r.poster_url, 96)} alt="" width="28" height="42" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="thumb blank" />}
                    <span className="row-title">{r.title}{r.year ? <span className="year"> {r.year}</span> : null}{r.artist ? <span className="year"> · {r.artist}</span> : null}</span>
                    {isRecent(r) && <span className="tag new">new</span>}
                    {r.requested_by && <span className="for" style={{ '--c': profiles[r.requested_by]?.color || '#999' }}>for {r.requested_by === session.user.id ? 'you' : who(r.requested_by)}</span>}
                    <span className="row-when">{timeAgo(r.imported_at || r.created_at)}</span>
                    {r.play_url && <a className="btn tiny" href={r.play_url} target="_blank" rel="noreferrer">play</a>}
                  </li>
                ))}
              </ul>
            )}
            <div className="actions">
              {shelf.length > shelfPage * PAGE && <button className="btn more" onClick={() => setShelfPage((p) => p + 1)}>load more</button>}
              {olderCount > 0 && <button className="link more" onClick={() => { setShelfOlder((v) => !v); setShelfPage(1) }}>{shelfOlder ? 'hide older than 90 days' : `show ${olderCount} older`}</button>}
            </div>
          </section>
      </div>

      <Greeting arrivals={arrivals} isFresh={isFresh} loaded={rowsLoaded && libLoaded} who={who} profiles={profiles} me={session.user.id} onOpen={(r) => setOpen(r)} />

      {!adding && (
        <button className="fab" onClick={openForm} aria-label="request something">
          <span className="plus">+</span> request
        </button>
      )}

      {openRow && (
        <Sheet
          row={openRow}
          trail={trailFor[openRow.request_id || openRow.id] || []}
          who={who}
          cache={detailCache}
          isAdmin={isAdmin}
          scanning={!!scanning[openRow.id]}
          missed={!!missed[openRow.id]}
          onImported={() => markImported(openRow.id)}
          canPull={canPull(openRow)}
          pulling={!!pulling[openRow.id]}
          onAskPull={() => askPull(openRow.id)}
          onPull={() => pull(openRow.id)}
          onClose={() => setOpen(null)}
        />
      )}

      <footer className="foot">
        <button className="link more" onClick={() => supabase.auth.signOut()}>sign out</button>
      </footer>
    </main>
  )
}

// one ticket in the line. it lives out here, not inside Feed, so it keeps its identity between renders:
// no remount on every realtime reload, no replayed tear, and a button you're focused on stays put.
function LineRow({ r, isNew, thud, isAdmin, scanning, missed, canPull, pulling, onOpen, onImported, onAskPull, onPull }) {
  return (
    <li className={'row ' + r.status + (isNew ? ' tear' : '')} onClick={(e) => { if (!e.target.closest('a,button')) onOpen(r) }}>
      <span className="row-title">{r.title}{r.year ? <span className="year"> {r.year}</span> : null}{r.artist ? <span className="year"> · {r.artist}</span> : null}</span>
      <span className="row-when">{timeAgo(r.created_at)}</span>
      {r.status === 'grabbed' && <span className={'badge grabbed' + (thud ? ' thud' : '')}>grabbing</span>}
      {(isAdmin || canPull) && (
        <span className="row-actions">
          {isAdmin && <button className={'btn tiny' + (scanning ? ' busy' : '') + (missed ? ' missed' : '')} disabled={scanning} onClick={() => onImported(r.id)}>{scanning ? 'scanning' : missed ? 'not on the shelf yet' : 'imported'}</button>}
          {canPull && (pulling
            ? <button className="btn tiny pull sure" onClick={() => onPull(r.id)}>sure?</button>
            : <button className="link tiny pull" onClick={() => onAskPull(r.id)}>nevermind</button>)}
        </span>
      )}
    </li>
  )
}

// true when the element's whole height fits in the viewport under its sticky top, with room left for the request
// button. css only applies the sticky position at desktop widths; this just says whether it's safe to.
const FAB_CLEARANCE = 88
function useFitsBelowSign(ref) {
  const [fits, setFits] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => {
      const top = parseFloat(getComputedStyle(el).getPropertyValue('--stick-top')) || 0
      setFits(el.offsetHeight <= window.innerHeight - top - FAB_CLEARANCE)
    }
    const ro = new ResizeObserver(check)
    ro.observe(el)
    window.addEventListener('resize', check)
    check()
    return () => { ro.disconnect(); window.removeEventListener('resize', check) }
  }, [ref])
  return fits
}

const REEL_DAYS = 7 * 24 * 3600 * 1000
const SEEN_KEY = 'movie-night:reel-seen'

/* what landed recently, who put it there, and when. two sources, one list: the request trail (media_events, event = imported)
   knows the moment reconcile or a scan flipped a request, and the servers themselves (the shelf function) know about
   anything dropped in without a request. rows carry the shelf item when there is one so posters and play links come along. */
function useArrivals(events, rows, ready, adder) {
  return useMemo(() => {
    const cutoff = Date.now() - REEL_DAYS
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    const byLib = Object.fromEntries(ready.filter((r) => r.library_item_id).map((r) => [r.library_item_id, r]))
    const out = []
    const covered = new Set()
    for (const ev of events) {
      if (ev.event !== 'imported' || new Date(ev.at).getTime() < cutoff) continue
      const req = byId[ev.request_id]
      if (!req) continue
      const item = req.library_item_id ? byLib[req.library_item_id] : null
      if (req.library_item_id) covered.add(req.library_item_id)
      out.push({ id: `ev:${ev.id}`, key: req.library_item_id || req.id, at: ev.at, actor: ev.actor, row: item || req })
    }
    for (const r of ready) {
      if (!r.added_at || covered.has(r.library_item_id) || new Date(r.added_at).getTime() < cutoff) continue
      out.push({ id: `lib:${r.library_item_id}`, key: r.library_item_id, at: r.added_at, actor: adder, row: r })
    }
    return out.sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [events, rows, ready, adder])
}

/* the greeting: once, on load, if anything landed since you were last here, a stub that says so and lists it.
   "got it" (or tapping away) moves the mark. plus toasts for anything that lands while the page is open. */
function Greeting({ arrivals, isFresh, loaded, who, profiles, me, onOpen }) {
  const [show, setShow] = useState(false)
  const [toasts, setToasts] = useState([])
  const known = useRef(null)
  const greeted = useRef(false)

  const fresh = arrivals.filter(isFresh)

  useEffect(() => {
    if (greeted.current || !loaded) return
    greeted.current = true
    if (fresh.length > 0) setShow(true)
  }, [loaded, fresh.length])

  // toast anything that arrives after first load
  useEffect(() => {
    if (!loaded) return
    const keys = new Set(arrivals.map((a) => a.key))
    if (known.current === null) { known.current = keys; return }
    const newOnes = arrivals.filter((a) => !known.current.has(a.key))
    known.current = keys
    if (!newOnes.length) return
    setToasts((t) => [...newOnes.map((a) => ({ id: a.id, a })), ...t].slice(0, 4))
    for (const n of newOnes) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 7000)
  }, [arrivals, loaded])

  function dismiss() {
    store.set(SEEN_KEY, arrivals[0]?.at || new Date().toISOString())
    setShow(false)
  }

  // no scroll lock: a greeting must never be able to trap anyone. the page behind stays scrollable (on ios a locked
  // body plus a greeting taller than the visible screen left "got it" under safari's toolbar with no way out)
  useEffect(() => {
    if (!show) return
    const onKey = (e) => e.key === 'Escape' && dismiss()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show])

  const name = (a) => (a.actor ? who(a.actor) : null)
  const asked = (a) => (a.row.requested_by && a.row.requested_by !== a.actor ? a.row.requested_by : null)
  const forWhom = (a) => {
    const uid = asked(a)
    if (!uid) return null
    return <span className="for" style={{ '--c': profiles[uid]?.color || '#999' }}>for {uid === me ? 'you' : who(uid)}</span>
  }
  const line = (a) => <>{name(a) ? <><strong>{name(a)}</strong> added </> : 'now on the shelf: '}<em>{a.row.title}</em>{asked(a) && <> {forWhom(a)}</>}</>

  // "2 movies and an album"
  const summary = (() => {
    const n = { movie: 0, show: 0, album: 0 }
    for (const a of fresh) if (a.row.type in n) n[a.row.type]++
    const parts = TYPES.filter((t) => n[t]).map((t) => n[t] === 1 ? `${t === 'album' ? 'an' : 'a'} ${t}` : `${n[t]} ${t}s`)
    return parts.length <= 1 ? parts[0] || '' : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
  })()

  // everything you missed, grouped by type; the list scrolls inside the window and its artwork loads lazily
  const groups = TYPES.map((t) => [t, fresh.filter((a) => a.row.type === t)]).filter(([, l]) => l.length)

  return (
    <>
      <div className="reel-toasts" aria-live="polite">
        {toasts.map(({ id, a }) => (
          <button key={id} className="reel-toast" onClick={() => { setToasts((t) => t.filter((x) => x.id !== id)); onOpen(a.row) }}>
            {a.row.poster_url ? <img src={sized(a.row.poster_url, 110)} alt="" width="34" height="51" decoding="async" /> : <span className="thumb blank" />}
            <span>
              <span className="reel-line">{line(a)}</span>
              <span className="reel-when">{when(a.at)}</span>
            </span>
          </button>
        ))}
      </div>

      {show && (
        <div className="greet-wrap" onClick={dismiss}>
          {/* head and foot never scroll away: close and "got it" are always on screen, only the list between them scrolls */}
          <section className="greet stub tear" role="dialog" aria-labelledby="greet-title" onClick={(e) => e.stopPropagation()}>
            <div className="greet-head">
              <p className="greet-kicker">since you were last here</p>
              <h2 className="greet-title" id="greet-title">{summary} landed on the shelf</h2>
              <button className="greet-close" onClick={dismiss} aria-label="close">close</button>
            </div>
            <div className="reel-groups greet-list">
              {groups.map(([t, list]) => (
                <div key={t} className="reel-group">
                  <div className="reel-type">{t}s</div>
                  <ul className="reel-list">
                    {list.map((a) => (
                      <li key={a.id}>
                        <button className="reel-item" onClick={() => { dismiss(); onOpen(a.row) }}>
                          {a.row.poster_url ? <img src={sized(a.row.poster_url, 110)} alt="" width="34" height="51" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="thumb blank" />}
                          <span className="reel-body">
                            <span className="reel-title">{a.row.title}{a.row.artist ? <span className="reel-sub"> {a.row.artist}</span> : null}</span>
                            <span className="reel-when">{name(a) ? `${name(a)} added it, ` : ''}{when(a.at)}</span>
                            {asked(a) && <span className="reel-for">{forWhom(a)}</span>}
                          </span>
                          {a.row.play_url && <a className="btn tiny" href={a.row.play_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>play</a>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="greet-foot">
              <button className="primary" onClick={dismiss}>got it</button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

function Sheet({ row, trail, who, cache, isAdmin, scanning, missed, onImported, canPull, pulling, onAskPull, onPull, onClose }) {
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
          {(d?.poster_url || row.poster_url) && <img className="sheet-poster" src={sized(d?.poster_url || row.poster_url, 300)} alt="" width="92" height="138" decoding="async" onError={(e) => (e.currentTarget.style.display = 'none')} />}
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
                <button className={'btn' + (scanning ? ' busy' : '') + (missed ? ' missed' : '')} disabled={scanning} onClick={onImported}>{scanning ? 'scanning the shelf' : missed ? 'not on the shelf yet' : 'imported'}</button>
              </>
            ) : (
              <span className={'stamp ' + row.status}>{row.status === 'grabbed' ? 'grabbing it' : 'on the list'}</span>
            )}
            {canPull && (pulling
              ? <button className="btn pull sure" onClick={onPull}>sure? take it off the list</button>
              : <button className="link pull" onClick={onAskPull}>nevermind</button>)}
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
                  {c.poster_url ? <img src={sized(c.poster_url, 120)} alt="" width="36" height="54" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="noposter" />}
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
