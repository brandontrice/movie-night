// reconcile: flip requested/grabbed requests to imported when the item shows up on the shelf.
// Runs unattended (pg_cron / manual curl), so it authenticates with a shared secret
// and writes with the service-role key instead of a user session.
//
// POST  with header  x-reconcile-secret: <RECONCILE_SECRET>
// -> { checked: n, imported: n, items: [{ id, title, play_url }] }
// add ?debug=1 to also get jellyfin_count, failed (PATCH errors) and unmatched samples
//
// Matching, in order:
//   movie/show : ProviderIds.Tmdb == external_id   ->  normalized title + year  ->  normalized title
//   album      : musicBrainzId == external_id      ->  normalized title + artist ->  normalized title

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reconcile-secret',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RECONCILE_SECRET = Deno.env.get('RECONCILE_SECRET') ?? ''
const RECONCILE_ACTOR = Deno.env.get('RECONCILE_ACTOR') || null  // auth user id credited for auto-imports (brandon)
const JELLYFIN_URL = (Deno.env.get('JELLYFIN_URL') ?? '').replace(/\/$/, '')
const JELLYFIN_KEY = Deno.env.get('JELLYFIN_KEY') ?? ''
const JELLYFIN_USER_ID = Deno.env.get('JELLYFIN_USER_ID') ?? ''  // un-scoped /Items misses items; scope to a user like the web UI does
const NAVIDROME_URL = (Deno.env.get('NAVIDROME_URL') ?? '').replace(/\/$/, '')
const NAVIDROME_USER = Deno.env.get('NAVIDROME_USER') ?? ''
const NAVIDROME_PASS = Deno.env.get('NAVIDROME_PASS') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const hex = (s: string) => Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join('')
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const jellyfinHeaders = {
  Authorization: `MediaBrowser Token="${JELLYFIN_KEY}", Client="MovieNight", Device="edge", DeviceId="movienight", Version="1.0"`,
}

function subsonicUrl(path: string, params: Record<string, string>) {
  const u = new URL(`${NAVIDROME_URL}/rest/${path}`)
  u.searchParams.set('u', NAVIDROME_USER)
  u.searchParams.set('p', 'enc:' + hex(NAVIDROME_PASS))
  u.searchParams.set('v', '1.16.1')
  u.searchParams.set('c', 'movienight')
  u.searchParams.set('f', 'json')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u
}

// service-role PostgREST: bypasses RLS, no user session
function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
}

type Req = {
  id: string
  type: 'movie' | 'show' | 'album'
  title: string
  year: number | null
  artist: string | null
  external_id: string | null
}
type LibItem = { id: string; title: string; year: number | null; artist: string | null; ext: string | null; play_url: string }

async function jellyfinLibrary(): Promise<LibItem[]> {
  if (!JELLYFIN_URL || !JELLYFIN_KEY) return []
  const base = JELLYFIN_USER_ID ? `${JELLYFIN_URL}/Users/${JELLYFIN_USER_ID}/Items` : `${JELLYFIN_URL}/Items`
  const u = `${base}?IncludeItemTypes=Movie,Series&Recursive=true&Limit=2000&Fields=ProductionYear,ProviderIds`
  const r = await fetch(u, { headers: jellyfinHeaders })
  if (!r.ok) return []
  const data = await r.json()
  return (data.Items ?? []).map((i: any) => ({
    id: i.Id,
    title: i.Name,
    year: i.ProductionYear ?? null,
    artist: null,
    ext: i.ProviderIds?.Tmdb ? String(i.ProviderIds.Tmdb) : null,
    play_url: `${JELLYFIN_URL}/web/index.html#/details?id=${i.Id}`,
  }))
}

async function navidromeLibrary(): Promise<LibItem[]> {
  if (!NAVIDROME_URL || !NAVIDROME_USER) return []
  const r = await fetch(subsonicUrl('getAlbumList2', { type: 'newest', size: '500' }))
  if (!r.ok) return []
  const data = await r.json()
  const albums = data?.['subsonic-response']?.albumList2?.album ?? []
  return albums.map((a: any) => ({
    id: a.id,
    title: a.name,
    year: a.year ?? null,
    artist: a.artist ?? null,
    ext: a.musicBrainzId ?? null,
    play_url: `${NAVIDROME_URL}/app/#/album/${a.id}/show`,
  }))
}

function match(req: Req, lib: LibItem[]): LibItem | null {
  const ext = req.external_id ? String(req.external_id) : null
  if (ext) {
    const byId = lib.find((i) => i.ext && i.ext === ext)
    if (byId) return byId
  }
  const t = norm(req.title)
  if (!t) return null
  if (req.type === 'album') {
    const a = norm(req.artist)
    return (
      lib.find((i) => norm(i.title) === t && (!a || norm(i.artist).includes(a))) ??
      lib.find((i) => norm(i.title) === t) ??
      null
    )
  }
  return (
    lib.find((i) => norm(i.title) === t && (!req.year || i.year === req.year)) ??
    lib.find((i) => norm(i.title) === t) ??
    null
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!RECONCILE_SECRET || req.headers.get('x-reconcile-secret') !== RECONCILE_SECRET) {
    return json({ error: 'forbidden' }, 403)
  }

  try {
    const pendRes = await rest(`media_requests?status=in.(requested,pending,grabbed)&select=id,type,title,year,artist,external_id`)
    if (!pendRes.ok) return json({ error: await pendRes.text() }, 500)
    const pending: Req[] = await pendRes.json()
    if (pending.length === 0) return json({ checked: 0, imported: 0, items: [] })

    const needVideo = pending.some((p) => p.type !== 'album')
    const needAudio = pending.some((p) => p.type === 'album')
    const [jf, nd] = await Promise.all([needVideo ? jellyfinLibrary() : [], needAudio ? navidromeLibrary() : []])

    const imported: { id: string; title: string; play_url: string }[] = []
    const failed: { id: string; title: string; error: string }[] = []
    const unmatched: { title: string; external_id: string | null }[] = []
    for (const p of pending) {
      const hit = match(p, p.type === 'album' ? nd : jf)
      if (!hit) { unmatched.push({ title: p.title, external_id: p.external_id }); continue }
      const patch = { status: 'imported', play_url: hit.play_url, library_item_id: hit.id, imported_by: RECONCILE_ACTOR }
      const up = await rest(`media_requests?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      if (up.ok) imported.push({ id: p.id, title: p.title, play_url: hit.play_url })
      else failed.push({ id: p.id, title: p.title, error: (await up.text()).slice(0, 300) })
    }

    const debug = new URL(req.url).searchParams.get('debug') === '1'
    return json({
      checked: pending.length, imported: imported.length, items: imported,
      ...(debug ? { jellyfin_count: jf.length, navidrome_count: nd.length, failed, unmatched: unmatched.slice(0, 50) } : {}),
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
