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

// what "since you were last here" compares against: 3 days back shows the greeting, now shows nothing new
const SEEN_KEY = 'movie-night:reel-seen'
const SCENES = window.__SCENES = {}
const DAY = 864e5
localStorage.setItem(SEEN_KEY, new RealDate(NOW - (P.get('seen') === 'now' ? 0 : 3 * DAY)).toISOString())

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
const click = async (sel, text) => (await find(() => (text ? byText(sel, text) : q(sel)))).click()
async function type(sel, value) {
  const el = await find(() => q(sel))
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const loaded = () => find(() => q('.shelf, .block .hint'))
const dismissGreeting = async () => { await click('.greet .primary'); await sleep(100) }

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
  'sheet-pull':      { shot: 'view', run: async () => { await dismissGreeting(); await click('.line .row', lineReq.title); await click('.sheet .pull', 'nevermind') } },
  'line-actions':    { shot: 'view', run: async () => { await dismissGreeting(); await click('.line .btn', 'imported'); await click('.line .pull', 'nevermind'); scrollToBlock('the line'); await sleep(900) } },
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
// the marquee is sticky, so land the block a little below it rather than under it
function scrollToBlock(heading) {
  const b = byText('.block .h', heading).closest('.block')
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
  await sleep(900) // let entrance animations land
  await document.fonts?.ready
  window.__ready = 'ok'
} catch (e) {
  window.__ready = 'error: ' + e.message
}
