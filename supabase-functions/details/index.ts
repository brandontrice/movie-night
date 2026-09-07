// details: background on one item
// POST { type: 'movie' | 'show' | 'album', external_id: string }
// -> { tagline, overview, year, runtime, genres[], rating, director, cast[], backdrop_url, poster_url, tracks[], label }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const TMDB_TOKEN = Deno.env.get('TMDB_TOKEN') ?? ''
const MB_UA = { 'User-Agent': 'MovieNight/1.0 (homelab request list)' }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function tmdb(path: string) {
  const r = await fetch(`https://api.themoviedb.org/3${path}`, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } })
  return r.ok ? r.json() : null
}

async function movieDetails(id: string, type: string) {
  const kind = type === 'show' ? 'tv' : 'movie'
  const d = await tmdb(`/${kind}/${id}?append_to_response=credits,content_ratings,release_dates&language=en-US`)
  if (!d) return null
  const credits = d.credits ?? {}
  const director =
    kind === 'movie'
      ? credits.crew?.find((c: any) => c.job === 'Director')?.name ?? null
      : d.created_by?.map((c: any) => c.name).join(', ') || null
  let rating: string | null = null
  if (kind === 'movie') {
    const us = d.release_dates?.results?.find((r: any) => r.iso_3166_1 === 'US')
    rating = us?.release_dates?.find((x: any) => x.certification)?.certification ?? null
  } else {
    rating = d.content_ratings?.results?.find((r: any) => r.iso_3166_1 === 'US')?.rating ?? null
  }
  const runtime = kind === 'movie' ? d.runtime : d.episode_run_time?.[0] ?? null
  return {
    tagline: d.tagline || null,
    overview: d.overview || null,
    year: (d.release_date ?? d.first_air_date ?? '').slice(0, 4) || null,
    runtime: runtime ?? null,
    seasons: kind === 'tv' ? d.number_of_seasons ?? null : null,
    genres: (d.genres ?? []).map((g: any) => g.name),
    rating,
    score: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    director,
    cast: (credits.cast ?? []).slice(0, 6).map((c: any) => ({ name: c.name, as: c.character })),
    backdrop_url: d.backdrop_path ? `https://image.tmdb.org/t/p/w780${d.backdrop_path}` : null,
    poster_url: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
    tracks: [],
    label: null,
  }
}

async function albumDetails(rgid: string) {
  const rg = await fetch(`https://musicbrainz.org/ws/2/release-group/${rgid}?inc=artist-credits+genres&fmt=json`, { headers: MB_UA }).then((r) => (r.ok ? r.json() : null))
  if (!rg) return null
  // pick one release for the tracklist and label
  const rel = await fetch(`https://musicbrainz.org/ws/2/release/?release-group=${rgid}&fmt=json&limit=1`, { headers: MB_UA }).then((r) => (r.ok ? r.json() : null))
  const relId = rel?.releases?.[0]?.id
  let tracks: { n: number; title: string; length: string | null }[] = []
  let label: string | null = null
  if (relId) {
    const full = await fetch(`https://musicbrainz.org/ws/2/release/${relId}?inc=recordings+labels&fmt=json`, { headers: MB_UA }).then((r) => (r.ok ? r.json() : null))
    label = full?.['label-info']?.[0]?.label?.name ?? null
    let n = 0
    for (const m of full?.media ?? []) {
      for (const t of m.tracks ?? []) {
        n++
        const ms = t.length ?? t.recording?.length
        tracks.push({ n, title: t.title, length: ms ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` : null })
      }
    }
  }
  return {
    tagline: null,
    overview: null,
    year: (rg['first-release-date'] ?? '').slice(0, 4) || null,
    runtime: null,
    seasons: null,
    genres: (rg.genres ?? []).slice(0, 4).map((g: any) => g.name),
    rating: null,
    score: null,
    director: rg['artist-credit']?.map((a: any) => a.name).join(', ') ?? null,
    cast: [],
    backdrop_url: null,
    poster_url: `https://coverartarchive.org/release-group/${rgid}/front-500`,
    tracks,
    label,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { type, external_id } = await req.json()
    if (!external_id) return json({ error: 'nothing to look up' }, 400)
    const d = type === 'album' ? await albumDetails(external_id) : await movieDetails(external_id, type)
    return d ? json(d) : json({ error: 'not found' }, 404)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
