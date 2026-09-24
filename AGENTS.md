# Movie Night: orientation for an AI agent

A shared media request app for two people, Brandon and Cate. Either of them asks
for a movie, show or album; Brandon puts it on the servers (Jellyfin for video,
Navidrome for music); the app notices and says so. It runs on a database that
**two other apps also use**, so read section 1 before touching anything.

---

## 1. The shared database: the one thing that will hurt someone

One self-hosted Supabase instance on VM 102 (`btrice9595@192.168.1.118`) backs
**three** apps:

| App | Served at | Owner |
|---|---|---|
| Cate's Kitchen | :80 | Cate, **live, in daily use** |
| Brandon's Kitchen | :8082 | Brandon |
| **Movie Night** (this repo) | **:8081** | Brandon and Cate |

Rules, not negotiable without Brandon saying so explicitly, per instance:

1. **Never make a database change that could affect the Kitchen apps.** Movie
   Night owns `media_requests`, `media_events` and `profiles` and nothing else.
   Do not touch other tables, shared functions, extensions, roles, auth
   settings or the `cron` schema beyond the `movie-night-reconcile` job.
2. **Changes to Movie Night's own tables are additive only.** New nullable
   columns, or columns with a default. No renames, drops, type changes or
   destructive statements. Propose the full SQL and wait for approval.
3. **Design work is presentation only.** No schema or edge function changes
   inside a design phase. If one seems needed, stop and ask.
4. Reading the schema is fine and often necessary:

```bash
ssh btrice9595@192.168.1.118 "docker exec -i supabase-db psql -U postgres -d postgres" <<'EOF'
\d public.media_requests
EOF
```

### What the frontend depends on

- `media_requests`: one row per ask. `status` is `requested`, `grabbed` or
  `imported` (CHECK constraint). "grabbed" is retired in the UI. No row uses it as
  of 2026-09-23, but the constraint still allows it, so the UI keeps a fallback.
- `media_events`: the trail. **Written only by the `media_requests_log`
  trigger**, never by the app. `imported` events credit
  `coalesce(imported_by, auth.uid(), requested_by)`.
- `media_requests_guard` trigger: on UPDATE, freezes every column except
  `status`, `play_url`, `library_item_id`, `imported_by`, and stamps
  `imported_at` when a row becomes imported.
- `profiles`: `display_name` and `color` per user. Read only.
- RLS: authenticated can read everything; insert only as yourself; delete only
  while `requested` and only your own (Brandon's UUID `204ef14b-...` can delete
  any). Updates are open to any authenticated user.
- Realtime: `media_requests` and `media_events` are in `supabase_realtime`.
- pg_cron: `movie-night-reconcile` posts to the reconcile function every 10 min.

---

## 2. Git sync: two working copies, one branch

| Copy | Machine |
|---|---|
| `C:\dev\movie-night` | the Windows PC |
| `~/dev/movie-night` | the Mint laptop |

GitHub (`brandontrice/movie-night`, remote over HTTPS) is the source of truth
and the only thing connecting them. Work that is not pushed does not exist as
far as the next session is concerned.

**At the start of every session, before editing anything:**

```bash
git fetch
git status
```

- Behind `origin`: `git pull --ff-only` before touching a file.
- **Uncommitted local changes, or a branch that has diverged from `origin`:
  stop and ask Brandon.** Do not stash, rebase, merge or commit your way out of
  it. A divergence means the other machine has work in it.
- **Never force-push.**

**At the end of every session, and whenever Brandon says he is switching
machines:** commit everything and push. A `wip:` commit is fine for unfinished
work; unpushed work leaves the next session nothing.

**Deployed means committed.** Every deploy of the frontend or of an edge
function is followed by a commit and push of the same code, so the live site is
always a build of `origin/main`. Line endings are LF everywhere
(`.gitattributes`), so both machines and the VM see the same bytes.

---

## 3. Deploy

**A change is not done until it is deployed and pushed.** Brandon tests against
the VM, not a dev server.

From the repo root, **after committing**, so the release is named for a real
commit:

```bash
npm run deploy                 # build, upload, switch, verify, prune
npm run deploy -- --rollback   # back to the previous release
curl -s http://192.168.1.118:8081/release.txt
```

`scripts/deploy.mjs` builds, uploads `dist/` into a fresh
`~/movie-night-releases/<utc stamp>-<commit>`, then atomically repoints the
symlink `~/movie-night` (nginx's root) at it. It fails loudly unless the served
page references exactly the bundle it just built and `release.txt` names the
new release. The newest 3 releases are kept, so stale bundles age out with
their release; a `-dirty` suffix means the tree had uncommitted changes.
`0-legacy` is the flat directory from before releases (Sep 2026) and is pruned
like any other. The Windows PC has key-based ssh to the VM.

Never `scp` into `~/movie-night` directly any more: it is a symlink into a
release, so you would be editing a past deploy in place.

nginx (`/etc/nginx/sites-available/movie-night`) sends `no-cache` for
`index.html` and `release.txt` and a one-year `immutable` for the hashed files in
`/assets/`, so a deploy reaches phones on the next load. Changing it needs sudo:
Brandon runs those commands himself.

### Edge functions

`supabase-functions/<name>/index.ts` is the canonical copy. On the VM each lives
at `~/supabase/docker/volumes/functions/<name>/index.ts`.

```bash
scp supabase-functions/<name>/index.ts btrice9595@192.168.1.118:~/supabase/docker/volumes/functions/<name>/index.ts
ssh btrice9595@192.168.1.118 "cd ~/supabase/docker && docker compose restart functions"
```

**Never edit a function in place on the VM.** If it happens anyway, copy it back
into the repo and commit it the same session. Check for drift read-only:

```bash
for f in reconcile shelf library-scan lookup details; do
  ssh btrice9595@192.168.1.118 "cat ~/supabase/docker/volumes/functions/$f/index.ts" \
    | diff -u supabase-functions/$f/index.ts - && echo "$f identical"
done
```

| Function | Called by | Talks to |
|---|---|---|
| `lookup` | request form typeahead | TMDB search, MusicBrainz, Jellyfin/Navidrome "already have it" |
| `details` | detail sheet | TMDB details, MusicBrainz + Cover Art Archive |
| `shelf` | app load; `GET ?art=` proxies album art | Jellyfin (scoped to Brandon's user), Navidrome |
| `library-scan` | Brandon's "imported" button | kicks a Jellyfin/Navidrome scan, flips the row only on a real match, as the calling user |
| `reconcile` | pg_cron every 10 min, shared secret | sweeps unimported rows, flips matches with the service role |

Server secrets (TMDB token, Jellyfin/Navidrome credentials, service key,
reconcile secret) stay in the functions' environment. **Never move one into the
client, log it, or return it.** Album art goes through `shelf?art=` for exactly
this reason.

---

## 4. Copy rules

- **All UI copy is lowercase and casual.** "nothing waiting. ask for something."
  not "No pending requests."
- **No em dashes anywhere in UI copy.** Use a comma, a colon, a period or
  "and". This includes aria labels, placeholders, toasts and errors.
- Theater vocabulary where it fits naturally: now showing, the line, the shelf,
  the marquee. Never force it.
- People are named by `profiles.display_name`; their own things are "yours" /
  "for you".

---

## 5. Layout

```
src/App.jsx              the whole app: Marquee, SignIn, Feed, Greeting, Sheet, AddForm
src/index.css            every style; tokens at the top of :root
src/lib/supabase.js      the client
supabase-functions/      canonical copies of the five edge functions
design/                  screenshot harness, see design/README.md
```

Stack: React 19 + Vite 8, plain JS, no router, no state library, no CSS
framework. Lint is `npm run lint` (oxlint). **No new dependencies without
asking.**

### The screenshot harness never changes data

`design/` renders the real app on a captured fixture (see `design/README.md`).
**Hard rule: no harness scene, script or agent ever presses a control that
changes or removes data**: nevermind, sure?, imported, delete, withdraw, sign
out, or anything added later that writes. Show those states by other means or
not at all. This holds at four layers, and `node design/shoot.mjs` runs a
self-test proving each one before it takes a single picture:

1. the scene driver refuses to click a forbidden control;
2. a capture-phase click listener swallows any click that lands on one anyway
   and fails the shot;
3. the stub client throws on update, delete, library-scan and sign out;
4. the shooter fails every non-GET request leaving the page, at the browser.

Never point the harness at the live client or a signed-in session, and never
weaken a guard to get a shot. The one write a scene may make is the stubbed
insert behind the "added" toast, which never leaves the page.

---

## 6. How Brandon wants you to work

- **Propose before building** anything substantial, and end every proposal with
  an explicit recommendation. Make the call and say why.
- Work in phases that end in a **STOP** for approval. Visual phases end with
  before/after screenshots at 390 and 1440, a build, then deploy, commit, push.
- **Full runnable commands and SQL**, and say which directory each runs in.
- If this file conflicts with what you find in the code, stop and say so.

---

## 7. Follow-ups, queued outside the design phases

Not to be started inside a design phase. Each is an edge function change, so it
needs Brandon's go-ahead, a deploy, and the drift check in section 3.

1. **Every title shows as unwatched.** `shelf` reads `UserData.Played` from
   Jellyfin's `/Users/{JELLYFIN_USER_ID}/Items`, and as of 2026-09-23 it is
   `false` for all 277 movies and shows, so now showing's "N unwatched" is the
   whole library and the watched fallback never kicks in. Suspects, in order:
   the `JELLYFIN_USER_ID` in the functions' env is not the account that
   actually watches; the plays happen under another Jellyfin user (a per-user
   flag, so "has anyone here watched it" needs both users checked); or the
   field is not being returned for this query. Start by comparing
   `UserData` for one title Brandon knows he has watched, per Jellyfin user.
2. **`shelf`, `details` and `lookup` answer without a key.** Anyone on the LAN
   can list the library, pull album art through the Navidrome proxy, and spend
   the TMDB quota; `library-scan` requires an Authorization header and
   `reconcile` a shared secret, so those two are fine. Fix: require a signed-in
   user's JWT (verify it in the function, or turn on JWT verification for these
   three), keeping `GET shelf?art=` working for `<img>` tags, which cannot
   send headers (a short-lived signed art URL, or accept the anon key there
   as today).
