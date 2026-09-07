// shelf: what's actually on the servers.
// POST {}                 -> { items: [...] }  newest first, movies + shows from Jellyfin, albums from Navidrome
// GET  ?art=<albumId>     -> image bytes (Navidrome cover art, proxied so credentials stay server-side)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const JELLYFIN_URL = (Deno.env.get('JELLYFIN_URL') ?? '').replace(/\/$/, '')
const JELLYFIN_KEY = Deno.env.get('JELLYFIN_KEY') ?? ''
const NAVIDROME_URL = (Deno.env.get('NAVIDROME_URL') ?? '').replace(/\/$/, '')
const NAVIDROME_USER = Deno.env.get('NAVIDROME_USER') ?? ''
const NAVIDROME_PASS = Deno.env.get('NAVIDROME_PASS') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const hex = (s: string) => Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join('')
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

async function jellyfinItems() {
  if (!JELLYFIN_URL || !JELLYFIN_KEY) return []
  const u = `${JELLYFIN_URL}/Users/${Deno.env.get('JELLYFIN_USER_ID')}/Items?IncludeItemTypes=Movie,Series&Recursive=true&SortBy=DateCreated&SortOrder=Descending&Limit=500&Fields=DateCreated,ProductionYear,ProviderIds,Overview,UserData`
  const r = await fetch(u, { headers: jellyfinHeaders })
  if (!r.ok) return []
  const data = await r.json()
  return (data.Items ?? []).map((i: any) => ({
    key: `jf:${i.Id}`,
    type: i.Type === 'Series' ? 'show' : 'movie',
    title: i.Name,
    year: i.ProductionYear ?? null,
    artist: null,
    poster_url: i.ImageTags?.Primary ? `${JELLYFIN_URL}/Items/${i.Id}/Images/Primary?maxHeight=450&tag=${i.ImageTags.Primary}` : null,
    play_url: `${JELLYFIN_URL}/web/index.html#/details?id=${i.Id}`,
    added_at: i.DateCreated ?? null,
    external_id: i.ProviderIds?.Tmdb ?? null,
    library_item_id: i.Id,
    // per-user watched flag (the query is scoped to brandon's jellyfin user, so this is "has anyone here watched it")
    played: !!i.UserData?.Played,
  }))
}

async function navidromeAlbums() {
  if (!NAVIDROME_URL || !NAVIDROME_USER) return []
  const r = await fetch(subsonicUrl('getAlbumList2', { type: 'newest', size: '500' }))
  if (!r.ok) return []
  const data = await r.json()
  const albums = data?.['subsonic-response']?.albumList2?.album ?? []
  return albums.map((a: any) => ({
    key: `nd:${a.id}`,
    type: 'album',
    title: a.name,
    year: a.year ?? null,
    artist: a.artist ?? null,
    poster_url: `art:${a.id}`, // the app turns this into a URL on this function
    play_url: `${NAVIDROME_URL}/app/#/album/${a.id}/show`,
    added_at: a.created ?? null,
    external_id: a.musicBrainzId ?? null,
    library_item_id: a.id,
    played: null,
  }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)

  // cover art proxy
  const art = url.searchParams.get('art')
  if (req.method === 'GET' && art) {
    const r = await fetch(subsonicUrl('getCoverArt', { id: art, size: '450' }))
    if (!r.ok) return new Response('no art', { status: 404, headers: cors })
    return new Response(r.body, {
      headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') ?? 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
    })
  }

  try {
    const [jf, nd] = await Promise.all([jellyfinItems(), navidromeAlbums()])
    const items = [...jf, ...nd].sort((a, b) => (b.added_at ?? '').localeCompare(a.added_at ?? ''))
    return json({ items })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
