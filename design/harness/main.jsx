// Harness entry: the real App and the real stylesheet, on fixture data, with a frozen clock and a scene driver.
// URL knobs: ?scene=<name>  plus the data knobs in mock-supabase.js (as, shelf, rows, details, lookup, scan).
import data from '../fixture/data.json'

const P = new URLSearchParams(location.search)
const scene = P.get('scene') || 'feed'

// freeze "now" at capture time (time still moves forward from there, so timers behave)
const NOW = new Date(P.get('now') || data.captured_at).getTime()
const t0 = performance.now()
const RealDate = Date
class FrozenDate extends RealDate {
  constructor(...a) { super(...(a.length ? a : [NOW + (performance.now() - t0)])) }
  static now() { return NOW + (performance.now() - t0) }
}
globalThis.Date = FrozenDate

// the house lights dim once per session; shots skip it unless a scene asks (?lights=1)
if (P.get('lights') !== '1') sessionStorage.setItem('movie-night:house-lights', 'harness')

// what "since you were last here" compares against: 3 days back shows the greeting, now shows nothing new
const SEEN_KEY = 'movie-night:reel-seen'
const SCENES = window.__SCENES = {}
const DAY = 864e5
// seen=now (nothing new), seen=<n>d (n days ago), seen=never (a phone that has never been here: every arrival
// of the last week is new, the longest greeting there can be). default 3 days
const seen = P.get('seen') || '3d'
if (seen === 'never') localStorage.removeItem(SEEN_KEY)
else localStorage.setItem(SEEN_KEY, new RealDate(NOW - (seen === 'now' ? 0 : parseInt(seen, 10) * DAY)).toISOString())

// ---- HARD RULE: the harness never presses anything that changes or removes data ----
// nevermind, sure?, imported, sign out, delete: the driver refuses to click them, and a capture-phase listener
// swallows any click that lands on one anyway and fails the shot. Three layers hold this (see design/README.md):
// this one, the stub client refusing writes, and shoot.mjs failing any non-GET request at the browser.
const FORBIDDEN = /\b(nevermind|sure\?|take it off|imported|sign out|delete|withdraw|remove)\b/i
const forbidden = (el) => {
  const b = el?.closest?.('button, a, [role="button"]')
  return !!b && (FORBIDDEN.test(b.textContent) || b.matches('.pull, .foot *'))
}
let violation = null
document.addEventListener('click', (e) => {
  if (!forbidden(e.target)) return
  e.preventDefault(); e.stopImmediatePropagation()
  violation ||= `clicked a forbidden control: "${e.target.closest('button, a').textContent.trim()}"`
}, true)

// ---- tiny driver ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function find(test, ms = 8000) {
  const end = performance.now() + ms
  while (performance.now() < end) {
    const el = test()
    if (el) return el
    await sleep(50)
  }
  throw new Error('harness: timed out waiting')
}
const q = (sel) => document.querySelector(sel)
const byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().toLowerCase().includes(text.toLowerCase()))
async function click(sel, text) {
  const el = await find(() => (text ? byText(sel, text) : q(sel)))
  if (forbidden(el)) throw new Error(`harness refuses to click "${el.textContent.trim()}": it changes or removes data`)
  el.click()
}
async function type(sel, value) {
  const el = await find(() => q(sel))
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
// loaded means the shelf has answered: its list, or a final hint (not "checking the shelf")
const loaded = async () => {
  await find(() => q('.shelf') || byText('.shelf-block .hint', 'nothing'))
  await find(() => q('.line .row') || byText('.line-block .hint', 'nothing waiting'))
}
// the greeting only shows when something landed since the last visit; dismiss it if it's there
const dismissGreeting = async () => {
  await loaded()
  // the greeting mounts a beat after the shelf answers; give it up to 1.5s (seen=now never gets one)
  if (P.get('seen') !== 'now') await find(() => q('.greet .greet-foot .primary, .greet .primary'), 1500).catch(() => null)
  const b = q('.greet .greet-foot .primary') || q('.greet .primary')
  if (b) { b.click(); await sleep(150) }
}

const shelfItems = data.shelf?.items ?? []
const firstOf = (type) => shelfItems.find((i) => i.type === type && (type === 'album' || data.details[`${type}:${i.external_id}`]))
const lineReq = data.requests.find((r) => r.status !== 'imported' && data.details[`${r.type}:${r.external_id}`])

// each scene: what to do after mount. `shot` is 'full' (the whole page) or 'view' (just the viewport)
Object.assign(SCENES, {
  'signin':          { shot: 'view', run: async () => { await find(() => q('.signin form')) } },
  'feed':            { shot: 'full', run: async () => { await dismissGreeting(); await loaded() } },
  'feed-quiet':      { shot: 'full', run: async () => { await loaded() } },
  'scrolled':        { shot: 'view', run: async () => { await dismissGreeting(); await loaded(); scrollTo(0, 1400); await sleep(500) } },
  'greeting':        { shot: 'view', run: async () => { await find(() => q('.greet')) } },
  'sheet-movie':     { shot: 'view', run: async () => { await dismissGreeting(); await click('.shelf .row', firstOf('movie').title); await find(() => q('.sheet-overview')); await sleep(600) } },
  'sheet-album':     { shot: 'view', run: async () => { await dismissGreeting(); await shelfFilter('albums'); await click('.shelf .row', firstOf('album').title); await find(() => q('.sheet .hint, .sheet .tracks')) } },
  'sheet-request':   { shot: 'view', run: async () => { await dismissGreeting(); await click('.line .row', lineReq.title); await find(() => q('.sheet-overview, .sheet .hint')); await sleep(600) } },
  'sheet-loading':   { shot: 'view', run: async () => { await dismissGreeting(); await click('.line .row', lineReq.title); await find(() => q('.sheet .skeleton')) } },
  // run by shoot.mjs before every set: each guard has to stop a forbidden action or nothing gets shot
  'selftest':        { shot: 'view', run: async () => {
    await dismissGreeting(); await loaded()
    let refused = false
    try { await click('.line .pull', 'nevermind') } catch { refused = true }
    if (!refused) throw new Error('selftest: driver clicked nevermind')
    byText('.line .pull', 'nevermind').click()                 // straight past the driver: the listener must eat it
    await sleep(100)
    if (!violation || byText('.line .pull', 'sure?')) throw new Error('selftest: click listener let nevermind through')
    violation = null
    const { supabase } = await import('./mock-supabase.js')
    for (const f of [() => supabase.from('media_requests').delete(), () => supabase.from('media_requests').update({}), () => supabase.auth.signOut()]) {
      let threw = false
      try { await f() } catch { threw = true }
      if (!threw) throw new Error('selftest: stub client allowed a write')
    }
    // browser layer: shoot.mjs must fail this and count exactly one blocked write (TEST-NET address, goes nowhere)
    await fetch('http://192.0.2.1/harness-selftest', { method: 'POST' }).catch(() => {})
  } },
  // keyboard focus, no clicks: the ring on paper (a shelf play link) and on night (the request button)
  'focus-paper':     { shot: 'view', run: async () => { await dismissGreeting(); const a = await find(() => q('.shelf .btn')); a.focus({ focusVisible: true }); scrollToBlock('the shelf') } },
  'focus-night':     { shot: 'view', run: async () => { await dismissGreeting(); (await find(() => q('.fab'))).focus({ focusVisible: true }) } },
  // desktop sidebar: scroll well down, then check the rule. a stuck sidebar must end above the request button's
  // clearance; one that doesn't fit must not be sticky. "see all" only shows more rows, so it's safe to press.
  'sidebar':         { shot: 'view', run: () => sidebar(false, 1600) },
  'sidebar-full':    { shot: 'view', run: () => sidebar(true, 1600) },
  'sidebar-full-top':{ shot: 'view', run: () => sidebar(true, 520) },
  'sidebar-page':    { shot: 'full', run: () => sidebar(true, 0) },
  // the house lights, caught partway through the dim
  'lights':          { shot: 'view', settle: 0, run: async () => { await find(() => q('.room.house-lights')); await sleep(450) } },
  'line':        { shot: 'view', run: async () => { await dismissGreeting(); await loaded(); scrollToBlock('the line'); await sleep(300) } },
  'form-empty':      { shot: 'view', run: async () => { await dismissGreeting(); await click('.fab'); scrollTo(0, 0) } },
  'form-results':    { shot: 'view', run: async () => { await dismissGreeting(); await click('.fab'); await type('.stub-form input', 'the notebook'); await find(() => q('.results:not(.skeleton) li')); await sleep(700) } },
  'form-owned':      { shot: 'view', run: async () => { await dismissGreeting(); await click('.fab'); await type('.stub-form input', data.owned_query); await find(() => q('.owned')); await sleep(700) } },
  'form-album':      { shot: 'view', run: async () => { await dismissGreeting(); await click('.fab'); await click('.picking .chip', 'album'); await type('.stub-form input', 'continuum'); await find(() => q('.results:not(.skeleton) li')); await sleep(700) } },
  'form-nomatch':    { shot: 'view', run: async () => { await dismissGreeting(); await click('.fab'); await type('.stub-form input', 'qxzv plorb'); await find(() => byText('.stub-form .hint', 'no matches')) } },
  'form-loading':    { shot: 'view', run: async () => { await dismissGreeting(); await click('.fab'); await type('.stub-form input', 'the notebook'); await find(() => q('.results.skeleton')) } },
  'form-added':      { shot: 'view', run: async () => { await dismissGreeting(); await click('.fab'); await type('.stub-form input', 'the notebook'); await click('.results li:not(.listed) button'); await find(() => q('.toast')); await sleep(350) } },
  'shelf-nomatch':   { shot: 'view', run: async () => { await dismissGreeting(); await type('.shelf-tools input', 'qxzv plorb'); await find(() => byText('.block .hint', 'nothing matches')); scrollToBlock('the shelf'); await sleep(300) } },
  'arrival-toast':   { shot: 'view', run: async () => { await dismissGreeting(); await loaded(); await window.__harness.arrive(); await find(() => q('.reel-toast')); await sleep(600) } },
  'loading':         { shot: 'full', run: async () => { await find(() => byText('.block .hint', 'checking the shelf')) } },
  'empty':           { shot: 'full', run: async () => { await find(() => byText('.block .hint', 'nothing on the servers')) } },
  'shelf-error':     { shot: 'full', run: async () => { await dismissGreeting().catch(() => {}); await find(() => byText('.block .hint', 'nothing on the servers')) } },
})
async function sidebar(expand, y) {
  await dismissGreeting(); await loaded()
  // expand every column, waiting for each to open before the next, so the measured height is the full one
  const seeAll = () => [...document.querySelectorAll('.line-col .link.more')].filter((b) => /see all/.test(b.textContent)).length
  while (expand && seeAll()) { const n = seeAll(); await click('.line-col .link.more', 'see all'); await find(() => seeAll() < n || null) }
  await sleep(300)
  scrollTo(0, y); await sleep(500)
  const el = q('.line-block')
  const r = el.getBoundingClientRect()
  const stuck = getComputedStyle(el).position === 'sticky'
  const room = innerHeight - 88
  if (stuck && r.bottom > room + 1) throw new Error(`sidebar is sticky but cut off: ends at ${Math.round(r.bottom)}, room to ${room}`)
  window.__note = `sidebar ${stuck ? 'sticks' : 'scrolls with the page'}: ${Math.round(r.height)}px tall, viewport ${innerHeight}px`
}

// the marquee is sticky, so land the block a little below it rather than under it
function scrollToBlock(heading) {
  const b = byText('.block .sec-title', heading).closest('.block')
  scrollTo(0, b.getBoundingClientRect().top + scrollY - 170)
}
async function shelfFilter(label) { await click('.shelf-tools .chip', label); await sleep(100) }

const s = SCENES[scene]
if (!s) throw new Error(`harness: no scene ${scene}`)
window.__shot = s.shot

await import('../../src/index.css')
const { default: App } = await import('../../src/App.jsx')
const { StrictMode, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
createRoot(document.getElementById('root')).render(createElement(StrictMode, null, createElement(App)))

try {
  await s.run()
  await sleep(s.settle ?? 900) // let entrance animations land
  await document.fonts?.ready
  window.__ready = violation ? 'error: ' + violation : 'ok'
} catch (e) {
  window.__ready = 'error: ' + e.message
}
