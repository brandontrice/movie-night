// library-scan: the "imported" tap.
// POST { id: uuid } with the user's Authorization header.
// Kicks a scan on Jellyfin (movie/show) or Navidrome (album), waits for it,
// finds the new item, and updates the request with status + play_url.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const JELLYFIN_URL = (Deno.env.get('JELLYFIN_URL') ?? '').replace(/\/$/, '')
const JELLYFIN_KEY = Deno.env.get('JELLYFIN_KEY') ?? ''
const NAVIDROME_URL = (Deno.env.get('NAVIDROME_URL') ?? '').replace(/\/$/, '')
const NAVIDROME_USER = Deno.env.get('NAVIDROME_USER') ?? ''
const NAVIDROME_PASS = Deno.env.get('NAVIDROME_PASS') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hex = (s: string) => Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join('')
const norm = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const jellyfinHeaders = {
  Authorization: `MediaBrowser Token="${JELLYFIN_KEY}", Client="MovieNight", Device="edge", DeviceId="movienight", Version="1.0"`,
}

function subsonic(path: string, params: Record<string, string>) {
  const u = new URL(`${NAVIDROME_URL}/rest/${path}`)
  u.searchParams.set('u', NAVIDROME_USER)
  u.searchParams.set('p', 'enc:' + hex(NAVIDROME_PASS))
  u.searchParams.set('v', '1.16.1')
  u.searchParams.set('c', 'movienight')
  u.searchParams.set('f', 'json')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return fetch(u).then((r) => r.json())
}

// talk to PostgREST as the calling user, so RLS and the event trigger see them
function rest(path: string, auth: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: auth,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
}

async function findJellyfin(title: string, year: number | null, type: string) {
  const kinds = type === 'show' ? 'Series' : 'Movie'
  const u = `${JELLYFIN_URL}/Users/${Deno.env.get('JELLYFIN_USER_ID')}/Items?searchTerm=${encodeURIComponent(title)}&IncludeItemTypes=${kinds}&Recursive=true&Limit=10&Fields=ProductionYear`
  const r = await fetch(u, { headers: jellyfinHeaders })
  if (!r.ok) return null
  const items = (await r.json()).Items ?? []
  const want = norm(title)
  const hit =
    items.find((i: any) => norm(i.Name) === want && (!year || i.ProductionYear === year)) ??
    items.find((i: any) => norm(i.Name) === want) ??
    items[0]
  return hit ? { id: hit.Id, play_url: `${JELLYFIN_URL}/web/index.html#/details?id=${hit.Id}` } : null
}

async function findNavidrome(title: string, artist: string | null) {
  const data = await subsonic('search3', { query: title, albumCount: '10', songCount: '0', artistCount: '0' })
  const albums = data?.['subsonic-response']?.searchResult3?.album ?? []
  const want = norm(title)
  const wantArtist = norm(artist ?? '')
  const hit =
    albums.find((a: any) => norm(a.name) === want && (!wantArtist || norm(a.artist).includes(wantArtist))) ??
    albums.find((a: any) => norm(a.name) === want) ??
    albums[0]
  return hit ? { id: hit.id, play_url: `${NAVIDROME_URL}/app/#/album/${hit.id}/show` } : null
}

async function scanJellyfin() {
  await fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jellyfinHeaders })
}

async function scanNavidrome() {
  await subsonic('startScan', {})
  for (let i = 0; i < 20; i++) {
    await sleep(2000)
    const s = await subsonic('getScanStatus', {})
    if (s?.['subsonic-response']?.scanStatus?.scanning === false) return
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ error: 'not signed in' }, 401)

  try {
    const { id } = await req.json()
    if (!id) return json({ error: 'missing id' }, 400)

    const rowRes = await rest(`media_requests?id=eq.${id}&select=*`, auth)
    const [row] = await rowRes.json()
    if (!row) return json({ error: 'request not found' }, 404)

    let found: { id: string; play_url: string } | null = null

    if (row.type === 'album') {
      await scanNavidrome()
      found = await findNavidrome(row.title, row.artist)
    } else {
      await scanJellyfin()
      // Jellyfin's refresh is async; poll for the item to appear
      for (let i = 0; i < 15 && !found; i++) {
        await sleep(3000)
        found = await findJellyfin(row.title, row.year, row.type)
      }
    }

    const patch = { status: 'imported', play_url: found?.play_url ?? null, library_item_id: found?.id ?? null }
    const up = await rest(`media_requests?id=eq.${id}`, auth, { method: 'PATCH', body: JSON.stringify(patch) })
    if (!up.ok) return json({ error: await up.text() }, 500)

    return json({ ok: true, found: !!found, play_url: found?.play_url ?? null })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
