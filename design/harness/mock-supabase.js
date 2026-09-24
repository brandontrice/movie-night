// Stands in for src/lib/supabase.js inside the harness. Everything it returns comes from design/fixture/data.json,
// which is real data captured by design/capture-data.mjs. Scene knobs come from the URL (see design/harness/main.jsx).
import data from '../fixture/data.json'

const P = new URLSearchParams(location.search)
const who = P.get('as') || 'brandon'            // brandon | cate | out
const shelfMode = P.get('shelf') || 'ok'        // ok | slow | fail | empty
const rowsMode = P.get('rows') || 'ok'          // ok | empty
const detailsMode = P.get('details') || 'ok'    // ok | slow | fail
const lookupMode = P.get('lookup') || 'ok'      // ok | slow

const byName = Object.fromEntries(data.profiles.map((p) => [p.display_name, p]))
const me = byName[who]
// brandon signs in as the admin email the build was made with, so isAdmin lines up without the harness knowing it
const session = me ? { user: { id: me.user_id, email: who === 'brandon' ? import.meta.env.VITE_ADMIN_EMAIL : `${who}@harness.local` } } : null

const never = () => new Promise(() => {})
// hard rule: nothing here changes or removes data. updates, deletes, scans and sign out throw so a scene that
// reaches one fails loudly. insert is the one write a scene may make (the added toast) and it stays in this page.
const readOnly = (what) => { throw new Error(`harness is read-only: refused ${what}`) }
const later = (v, ms = 0) => new Promise((r) => setTimeout(() => r(v), ms))

// line=long is a layout stress case, not a picture of the real line: each person's most recent real imported
// requests are shown as still waiting, so both columns run to a dozen real titles. shot notes say so.
const lineMode = P.get('line') || 'ok'          // ok | long
// watched=some is a stress case too: jellyfin reports nothing as watched today (the played=false bug), so every third
// movie or show is marked watched to show the dimmed case and its stamp. shot notes say so.
const watchedMode = P.get('watched') || 'real'  // real | some
const shelfData = watchedMode === 'some' && data.shelf
  ? { ...data.shelf, items: data.shelf.items.map((i, k) => (i.type !== 'album' && k % 3 === 1 ? { ...i, played: true } : i)) }
  : data.shelf
function longLine(requests) {
  const extra = new Set()
  for (const p of data.profiles) {
    const waiting = requests.filter((r) => r.requested_by === p.user_id && r.status !== 'imported').length
    requests.filter((r) => r.requested_by === p.user_id && r.status === 'imported').slice(0, Math.max(0, 12 - waiting)).forEach((r) => extra.add(r.id))
  }
  return requests.map((r) => (extra.has(r.id) ? { ...r, status: 'requested', play_url: null, library_item_id: null, imported_at: null } : r))
}

const tables = {
  media_requests: rowsMode === 'empty' ? [] : lineMode === 'long' ? longLine(data.requests) : data.requests,
  media_events: rowsMode === 'empty' ? [] : data.events,
  profiles: data.profiles,
}

function query(table) {
  const q = {
    select: () => q, order: () => q, eq: () => q,
    insert: () => later({ error: null }), update: () => readOnly(`update on ${table}`), delete: () => readOnly(`delete on ${table}`),
    then: (res, rej) => later({ data: tables[table] ?? [], error: null }).then(res, rej),
  }
  return q
}

const functions = {
  async invoke(name, { body } = {}) {
    if (name === 'shelf') {
      if (shelfMode === 'slow') return never()
      if (shelfMode === 'fail') return { data: null, error: new Error('shelf down') }
      return { data: shelfMode === 'empty' ? { items: [] } : shelfData, error: null }
    }
    if (name === 'details') {
      if (detailsMode === 'slow') return never()
      const d = detailsMode === 'fail' ? null : data.details[`${body.type}:${body.external_id}`]
      return d ? { data: d, error: null } : { data: null, error: new Error('not found') }
    }
    if (name === 'lookup') {
      if (lookupMode === 'slow') return never()
      const hit = data.lookup[`${body.type}:${body.q}`]
      return { data: hit ?? { candidates: [], owned: [] }, error: null }
    }
    if (name === 'library-scan') readOnly('library-scan')
    return { data: null, error: new Error(`no fixture for ${name}`) }
  },
}

// realtime: keep the listeners so a scene can land something while the page is open
const listeners = []
const channel = { on: (_e, _f, cb) => { listeners.push(cb); return channel }, subscribe: () => channel }

// an import that happens while you're looking: an old request gets a fresh imported event, then realtime fires
const REEL = 7 * 864e5
window.__harness = {
  async arrive() {
    const recentLib = new Set((data.shelf?.items ?? []).filter((i) => Date.now() - new Date(i.added_at) < REEL).map((i) => i.library_item_id))
    const req = data.requests.find((r) => r.status === 'imported' && r.library_item_id && !recentLib.has(r.library_item_id))
    tables.media_events = [...tables.media_events, { id: 9e9, request_id: req.id, actor: req.imported_by || req.requested_by, event: 'imported', at: new Date().toISOString() }]
    for (const cb of listeners) cb({})
  },
}

export const supabase = {
  auth: {
    getSession: () => later({ data: { session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: () => later({ error: { message: 'harness' } }, 300),
    signOut: () => readOnly('sign out'),
  },
  from: query,
  functions,
  channel: () => channel,
  removeChannel() {},
}
