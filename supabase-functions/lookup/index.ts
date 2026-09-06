// lookup: typeahead search + "you already have this" check
// POST { q: string, type: 'movie' | 'show' | 'album' }
// -> { candidates: [...], owned: [...] }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TMDB_TOKEN = Deno.env.get('TMDB_TOKEN') ?? ''
const JELLYFIN_URL = (Deno.env.get('JELLYFIN_URL') ?? '').replace(/\/$/, '')
const JELLYFIN_KEY = Deno.env.get('JELLYFIN_KEY') ?? ''
const NAVIDROME_URL = (Deno.env.get('NAVIDROME_URL') ?? '').replace(/\/$/, '')
const NAVIDROME_USER = Deno.env.get('NAVIDROME_USER') ?? ''
const NAVIDROME_PASS = Deno.env.get('NAVIDROME_PASS') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const hex = (s: string) => Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join('')

export function subsonic(path: string, params: Record<string, string>) {
  const u = new URL(`${NAVIDROME_URL}/rest/${path}`)
  u.searchParams.set('u', NAVIDROME_USER)
  u.searchParams.set('p', 'enc:' + hex(NAVIDROME_PASS))
  u.searchParams.set('v', '1.16.1')
  u.searchParams.set('c', 'movienight')
  u.searchParams.set('f', 'json')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return fetch(u).then((r) => r.json())
}

export const jellyfinHeaders = {
  Authorization: `MediaBrowser Token="${JELLYFIN_KEY}", Client="MovieNight", Device="edge", DeviceId="movienight", Version="1.0"`,
}

async function searchTmdb(q: string, type: string) {
  const kind = type === 'show' ? 'tv' : 'movie'
  const u = `https://api.themoviedb.org/3/search/${kind}?query=${encodeURIComponent(q)}&include_adult=false&language=en-US&page=1`
  const r = await fetch(u, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } })
  if (!r.ok) return []
  const data = await r.json()
  return (data.results ?? []).slice(0, 6).map((m: any) => ({
    title: m.title ?? m.name,
    year: (m.release_date ?? m.first_air_date ?? '').slice(0, 4) || null,
    poster_url: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
    external_id: String(m.id),
    artist: null,
  }))
}

async function searchMusicBrainz(q: string) {
  const u = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&limit=8&fmt=json`
  const r = await fetch(u, { headers: { 'User-Agent': 'MovieNight/1.0 (homelab request list)' } })
  if (!r.ok) return []
  const data = await r.json()
  return (data['release-groups'] ?? [])
    .filter((g: any) => (g['primary-type'] ?? 'Album') === 'Album')
    .slice(0, 6)
    .map((g: any) => ({
      title: g.title,
      year: (g['first-release-date'] ?? '').slice(0, 4) || null,
      poster_url: `https://coverartarchive.org/release-group/${g.id}/front-250`,
      external_id: g.id,
      artist: g['artist-credit']?.map((a: any) => a.name).join(', ') ?? null,
    }))
}

async function ownedJellyfin(q: string, type: string) {
  if (!JELLYFIN_URL || !JELLYFIN_KEY) return []
  const kinds = type === 'show' ? 'Series' : 'Movie'
  const u = `${JELLYFIN_URL}/Items?searchTerm=${encodeURIComponent(q)}&IncludeItemTypes=${kinds}&Recursive=true&Limit=5&Fields=ProductionYear`
  const r = await fetch(u, { headers: jellyfinHeaders })
  if (!r.ok) return []
  const data = await r.json()
  return (data.Items ?? []).map((i: any) => ({
    title: i.Name,
    year: i.ProductionYear ?? null,
    play_url: `${JELLYFIN_URL}/web/index.html#/details?id=${i.Id}`,
  }))
}

async function ownedNavidrome(q: string) {
  if (!NAVIDROME_URL || !NAVIDROME_USER) return []
  const data = await subsonic('search3', { query: q, albumCount: '5', songCount: '0', artistCount: '0' })
  const albums = data?.['subsonic-response']?.searchResult3?.album ?? []
  return albums.map((a: any) => ({
    title: a.name,
    artist: a.artist ?? null,
    year: a.year ?? null,
    play_url: `${NAVIDROME_URL}/app/#/album/${a.id}/show`,
  }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { q = '', type = 'movie' } = await req.json()
    const query = String(q).trim()
    if (query.length < 2) return json({ candidates: [], owned: [] })

    const [candidates, owned] = await Promise.all([
      type === 'album' ? searchMusicBrainz(query) : searchTmdb(query, type),
      type === 'album' ? ownedNavidrome(query) : ownedJellyfin(query, type),
    ])
    return json({ candidates, owned })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
