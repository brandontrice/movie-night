// Snapshots real data into design/fixture/data.json so every before/after shot renders the same rows.
// Read-only: one SELECT over ssh for the three tables, then the same edge function calls the app makes.
// Run from the repo root:  node design/capture-data.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const VM = 'btrice9595@192.168.1.118'
const FN = 'http://192.168.1.118:8000/functions/v1'

const sql = `select json_build_object(
  'requests', (select coalesce(json_agg(r order by r.created_at desc), '[]') from public.media_requests r),
  'events',   (select coalesce(json_agg(e order by e.at), '[]') from public.media_events e),
  'profiles', (select coalesce(json_agg(p), '[]') from public.profiles p))`
const db = JSON.parse(execFileSync('ssh', ['-o', 'BatchMode=yes', VM, 'docker exec -i supabase-db psql -U postgres -d postgres -At'], { input: sql, maxBuffer: 64 << 20 }).toString())

const call = async (name, body) => {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.ok ? r.json() : null
}

const shelf = await call('shelf', {})

// details for every sheet a scene opens: the first shelf item of each type, and the first request in line with an id
const items = shelf?.items ?? []
const targets = [
  items.find((i) => i.type === 'movie' && i.external_id),
  items.find((i) => i.type === 'show' && i.external_id),
  items.find((i) => i.type === 'album' && i.external_id),
  ...db.requests.filter((r) => r.status !== 'imported' && r.external_id).slice(0, 3),
].filter(Boolean)
const details = {}
for (const t of targets) details[`${t.type}:${t.external_id}`] = await call('details', { type: t.type, external_id: String(t.external_id) })

// lookups the request-form scenes type: the placeholders, one that's already on the shelf, one with no matches
const firstMovie = items.find((i) => i.type === 'movie')
const queries = [
  ['movie', 'the notebook'],
  ['show', 'the bear'],
  ['album', 'continuum'],
  ['movie', firstMovie ? firstMovie.title : 'creed'],
  ['movie', 'qxzv plorb'],
]
const lookup = {}
for (const [type, q] of queries) lookup[`${type}:${q}`] = await call('lookup', { q, type })

mkdirSync('design/fixture', { recursive: true })
const out = { captured_at: new Date().toISOString(), ...db, shelf, details, lookup, owned_query: firstMovie?.title ?? 'creed' }
writeFileSync('design/fixture/data.json', JSON.stringify(out, null, 1))
console.log(`requests ${db.requests.length}, events ${db.events.length}, profiles ${db.profiles.length}, shelf ${items.length}, details ${Object.keys(details).length}, lookups ${Object.keys(lookup).length}`)
