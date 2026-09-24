// Screenshots every scene at 390 (phone, 2x) and 1440 (desktop) through headless Chrome, driven over the
// DevTools protocol with Node's built-in WebSocket, so there is nothing to install.
//
//   node design/capture-data.mjs            (once, or when you want fresher data)
//   npx vite build --config design/vite.config.js
//   node design/shoot.mjs before            -> design/shots/before/*.png + index.html contact sheet
//   node design/shoot.mjs p1 feed sheet-movie   (only the named shots)
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const [label = 'current', ...only] = process.argv.slice(2)
// REDUCED=1 shoots with prefers-reduced-motion: reduce
const REDUCED = process.env.REDUCED === '1'
const DIST = resolve('design/harness-dist')
const OUT = resolve('design/shots', label)
const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => p && existsSync(p))

// name, scene, extra query, note for the contact sheet
export const SHOTS = [
  ['signin', 'signin', 'as=out', 'signed out'],
  ['feed', 'feed', '', 'the landing view after the greeting is dismissed: now showing, the line, the shelf lit with new arrivals'],
  ['feed-quiet', 'feed-quiet', 'seen=now', 'nothing new since last visit'],
  ['feed-cate', 'feed', 'as=cate', "cate's view: her column is 'yours', no admin buttons"],
  ['scrolled', 'scrolled', '', 'marquee tucked into its compact sticky form'],
  ['greeting', 'greeting', '', 'since you were last here'],
  ['arrival-toast', 'arrival-toast', '', 'something lands while the page is open'],
  ['sheet-movie', 'sheet-movie', '', 'detail sheet: a movie on the shelf'],
  ['sheet-album', 'sheet-album', '', 'detail sheet: an album (no extra details)'],
  ['sheet-request', 'sheet-request', 'as=cate', 'detail sheet: a request still in line'],
  ['sheet-loading', 'sheet-loading', 'as=cate&details=slow', 'detail sheet: details loading'],
  ['line', 'line', '', "the line, brandon's view: every stub he can act on has a ... button"],
  ['line-cate', 'line', 'as=cate', "the line, cate's view: ... only on her own stubs"],
  ['tray-open', 'tray-open', '', 'a tray open under the first stub (opening it is safe; its buttons are never pressed)'],
  ['line-loading', 'line-loading', 'rows=slow&seen=now', 'the line loading'],
  ['line-error', 'line-error', 'rows=fail&seen=now', "the line failed to load: couldn't load the line, try again"],
  ['line-empty', 'line-empty', 'rows=empty&seen=now', 'nothing waiting: the ghost stub (it opens the request form)'],
  ['stubs', 'stubs', 'seen=now', 'harness preview, real rows: every stub state the harness is never allowed to trigger'],
  ['tray-last', 'tray-last', 'seen=now&line=long', 'the tray on the last stub of a full sidebar. STRESS FIXTURE. checks both buttons are reachable', [{ w: 1366, h: 768, scale: 1, mobile: false }, { w: 1440, h: 900, scale: 1, mobile: false }]],
  ['tray-last-collapsed', 'tray-last', 'seen=now&expand=0', 'the real line as it loads, tray opened on its last stub: where it fits it sticks; where the tray tips it over it has to let go and stay reachable', [{ w: 1366, h: 768, scale: 1, mobile: false }, { w: 1440, h: 900, scale: 1, mobile: false }, { w: 1440, h: 820, scale: 1, mobile: false, tag: '1440x820' }, { w: 1680, h: 1050, scale: 1, mobile: false }]],
  ['tray-last-real', 'tray-last', 'seen=now', 'the tray on the last stub of the real line, every column opened', [{ w: 1366, h: 768, scale: 1, mobile: false }, { w: 1440, h: 900, scale: 1, mobile: false }]],
  ['form-empty', 'form-empty', '', 'request form, fresh'],
  ['form-loading', 'form-loading', 'lookup=slow', 'request form: looking'],
  ['form-results', 'form-results', '', 'request form: results'],
  ['form-owned', 'form-owned', '', 'request form: already on the shelf'],
  ['form-album', 'form-album', '', 'request form: albums'],
  ['form-nomatch', 'form-nomatch', '', 'request form: no matches'],
  ['form-added', 'form-added', '', 'request form: added toast'],
  ['shelf-nomatch', 'shelf-nomatch', '', 'shelf search with nothing matching'],
  ['loading', 'loading', 'shelf=slow&seen=now', 'first load, shelf still coming'],
  ['empty', 'empty', 'rows=empty&shelf=empty', 'brand new: nothing requested, nothing on the servers'],
  ['focus-paper', 'focus-paper', '', 'keyboard focus on paper'],
  ['focus-night', 'focus-night', '', 'keyboard focus on night'],
  ['shelf-error', 'shelf-error', 'shelf=fail', "the shelf function failed: now showing says it couldn't reach the servers, with try again"],
  ['rail-all', 'rail-all', 'seen=now', '"all 277": a 3-column wall on phones, the lobby wall on desktop'],
  ['case-hover', 'case-hover', 'seen=now', 'the mouse resting on the lead case (moved there, never clicked)'],
  ['case-focus', 'case-focus', 'seen=now', 'keyboard focus on the lead case'],
  ['posters-broken', 'posters-broken', 'seen=now', 'two posters that fail to load, the lead included, become title cards (the failure, simulated)'],
  ['watched', 'feed-quiet', 'seen=now&watched=some', 'seen cases. STRESS FIXTURE: jellyfin reports nothing as watched today, so every third title is marked watched'],
  ['cases', 'cases', 'seen=now', 'harness preview: album sleeves, title cards (lead and small), a seen stamp, on real rows'],
  // desktop-only checks: an optional fifth entry overrides the viewports
  ['sidebar-stuck', 'sidebar', 'seen=now', 'desktop, scrolled down: the line sticks where it fits under the sign, and scrolls with the page where it does not', [{ w: 1440, h: 900, scale: 1, mobile: false }, { w: 1366, h: 768, scale: 1, mobile: false }]],
  ['sidebar-full', 'sidebar-full', 'seen=now&line=long', 'desktop, scrolled down, both columns full: too tall to stick, so it scrolls with the page. STRESS FIXTURE: real titles, some forced into the line', [{ w: 1440, h: 900, scale: 1, mobile: false }, { w: 1366, h: 768, scale: 1, mobile: false }]],
  ['sidebar-full-top', 'sidebar-full-top', 'seen=now&line=long', 'the same, scrolled just into the line: every row is reachable by scrolling. STRESS FIXTURE', [{ w: 1440, h: 900, scale: 1, mobile: false }, { w: 1366, h: 768, scale: 1, mobile: false }]],
  ['sidebar-page', 'sidebar-page', 'seen=now&line=long', 'the whole page with both columns full. STRESS FIXTURE', [{ w: 1366, h: 768, scale: 1, mobile: false }]],
  ['lights', 'lights', 'lights=1&seen=now', 'the house lights partway through dimming (first load of a session only)'],
]
const WIDTHS = [
  { w: 390, h: 844, scale: 2, mobile: true },
  { w: 1440, h: 900, scale: 1, mobile: false },
]

// ---- static server for the built harness ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = createServer((req, res) => {
  const p = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const file = existsSync(p) && !p.endsWith('\\') && !p.endsWith('/') ? p : join(DIST, 'index.html')
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(readFileSync(file)) }
  catch { res.writeHead(404).end() }
}).listen(0)
const base = `http://127.0.0.1:${server.address().port}/`

// ---- chrome over CDP ----
const port = 9300 + Math.floor(Math.random() * 400)
const profile = resolve('design/.chrome-profile')
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function cdpUp() {
  for (let i = 0; i < 100; i++) { try { return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() } catch { await sleep(100) } }
  throw new Error('chrome did not start')
}
await cdpUp()

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const waiting = new Map()
  const handlers = {}
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.method) return handlers[msg.method]?.(msg.params)
    if (msg.id && waiting.has(msg.id)) { const { ok, no } = waiting.get(msg.id); waiting.delete(msg.id); if (msg.error) no(new Error(msg.error.message)); else ok(msg.result) }
  }
  const send = (method, params = {}) => new Promise((ok, no) => { waiting.set(++id, { ok, no }); ws.send(JSON.stringify({ id, method, params })) })
  return new Promise((r) => (ws.onopen = () => r({ send, on: (method, cb) => (handlers[method] = cb), close: () => ws.close() })))
}

async function shoot([name, scene, extra], vp, { expectBlocked = 0 } = {}) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const page = await connect(t.webSocketDebuggerUrl)
  const { send } = page
  await send('Page.enable'); await send('Runtime.enable')
  // hard rule, browser layer: only reads leave this page. any other method to anywhere but the local harness server
  // is failed before it is sent, and the shot is marked as an error.
  const blocked = []
  page.on('Fetch.requestPaused', ({ requestId, request }) => {
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.url.startsWith(base)
    if (read) return send('Fetch.continueRequest', { requestId }).catch(() => {}) // the page may already be closing
    blocked.push(`${request.method} ${request.url}`)
    send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {})
  })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }) // headless pages are never focused, so :focus would never match
  if (REDUCED) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.scale, mobile: vp.mobile })
  await send('Page.navigate', { url: `${base}?scene=${scene}${extra ? '&' + extra : ''}` })
  let ready = null
  for (let i = 0; i < 300 && !ready; i++) {
    await sleep(100)
    ready = (await send('Runtime.evaluate', { expression: 'window.__ready || null', returnByValue: true })).result.value
  }
  const note = (await send('Runtime.evaluate', { expression: 'window.__note || null', returnByValue: true })).result.value
  if (expectBlocked) ready = ready === 'ok' && blocked.length === expectBlocked ? 'ok' : `error: expected ${expectBlocked} blocked write(s), saw ${blocked.length} (${ready})`
  else if (blocked.length) ready = `error: blocked a write: ${blocked[0]}`
  // a scene can ask for the mouse to rest somewhere (hover only; a move is not a click)
  const hover = (await send('Runtime.evaluate', { expression: 'window.__hover || null', returnByValue: true })).result.value
  if (hover) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y }); await sleep(400) }
  const kind = (await send('Runtime.evaluate', { expression: 'window.__shot', returnByValue: true })).result.value
  if (kind === 'full') {
    const h = (await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })).result.value
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: Math.min(h, 14000), deviceScaleFactor: vp.scale, mobile: vp.mobile })
    await sleep(400)
  }
  if (expectBlocked) { page.close(); await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`); return { ready } }
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${name}-${vp.tag ?? vp.w}.png`), Buffer.from(data, 'base64'))
  page.close()
  await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`)
  return { ready, note }
}

// the read-only guards have to prove themselves before any picture is taken
const { ready: test } = await shoot(['selftest', 'selftest', ''], WIDTHS[0], { expectBlocked: 1 })
if (test !== 'ok') { console.log(`selftest failed, nothing shot: ${test}`); chrome.kill(); server.close(); process.exit(1) }
console.log('selftest ok: driver, click listener, stub client and browser all refuse writes')

mkdirSync(OUT, { recursive: true })
const list = only.length ? SHOTS.filter((s) => only.includes(s[0])) : SHOTS
const problems = []
const notes = {}
for (const s of list) {
  for (const vp of s[4] ?? WIDTHS) {
    const { ready: r, note } = await shoot(s, vp)
    if (note) notes[`${s[0]}-${vp.tag ?? vp.w}`] = note
    console.log(`${r === 'ok' ? 'ok ' : '!! '} ${s[0]}-${vp.tag ?? vp.w}${r === 'ok' ? '' : '  ' + r}${note ? '   ' + note : ''}`)
    if (r !== 'ok') problems.push(`${s[0]}-${vp.tag ?? vp.w}: ${r}`)
  }
}

// contact sheet: every scene at every size it was shot at, with what the scene measured
const notesFile = join(OUT, 'notes.json')
const allNotes = { ...(existsSync(notesFile) ? JSON.parse(readFileSync(notesFile, 'utf8')) : {}), ...notes }
writeFileSync(notesFile, JSON.stringify(allNotes, null, 1))
const rows = SHOTS.map(([n, , , note, vps]) => {
  const shot = (vps ?? WIDTHS).filter((v) => existsSync(join(OUT, `${n}-${v.tag ?? v.w}.png`)))
  if (!shot.length) return ''
  const figs = shot.map((v) => `<figure><img src="${n}-${v.tag ?? v.w}.png" width="${v.w === 390 ? 390 : 960}" loading="lazy"><figcaption>${v.w}x${v.h}${allNotes[`${n}-${v.tag ?? v.w}`] ? ': ' + allNotes[`${n}-${v.tag ?? v.w}`] : ''}</figcaption></figure>`).join('')
  return `<section><h2>${n}</h2><p>${note}</p><div class="pair">${figs}</div></section>`
}).join('\n')
writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>movie night: ${label}</title>
<style>body{background:#111;color:#ddd;font:15px system-ui;margin:24px}section{margin:0 0 48px}h2{margin:0;font-size:18px}p{margin:4px 0 12px;color:#999}.pair{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}figure{margin:0}figcaption{color:#999;margin-top:4px}img{border:1px solid #333;height:auto;display:block}</style>
<h1>${label}</h1>${rows}`)

chrome.kill()
server.close()
await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
if (problems.length) { console.log('\nproblems:\n' + problems.join('\n')); process.exitCode = 1 }
