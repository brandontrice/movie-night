// Real mobile emulation: WebKit with an iPhone profile and Chromium with an Android profile (touch, device scale,
// the viewport meta honoured, a mobile user agent), on the same guarded harness build as shoot.mjs.
// Screenshots every scene it's given, then runs the mobile checks and fails loudly if any break.
//
//   npx vite build --config design/vite.config.js
//   node design/mobile.mjs <label> [scene ...]          -> design/shots/<label>/<scene>-iphone.png, -android.png
//
// Checks, on every scene:
//   - the page is never wider than the viewport (no sideways scroll, nothing for iOS to zoom out to)
//   - the viewport meta allows zoom (no maximum-scale, no user-scalable=no)
//   - no text input under 16px (iOS zooms the page in on focus)
// and when the greeting is showing:
//   - the page can still be scrolled by a finger (android: a real touch drag; iphone: nothing locks the page)
//   - its list scrolls under a finger when it's longer than the screen (android)
//   - close and "got it" are both fully on screen, and a touch tap on "got it" closes it
// and once, on the built css:
//   - no height or max-height in bare vh (ios vh runs under safari's toolbar; use dvh or svh)
import { webkit, chromium, devices } from 'playwright'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const [label = 'mobile', ...only] = process.argv.slice(2)
const DIST = resolve(process.env.DIST || 'design/harness-dist')
const OUT = resolve('design/shots', label)

export const PROFILES = [
  { key: 'iphone', engine: webkit, device: devices['iPhone 15'] },
  { key: 'android', engine: chromium, device: devices['Pixel 7'] },
  { key: 'small', engine: chromium, device: devices['Galaxy S9+'] },
  // the shortest real screen: a greeting has to fit even here
  { key: 'landscape', engine: webkit, device: devices['iPhone 15 landscape'], only: ['greeting', 'greeting-long', 'feed-quiet'] },
]
// scenes where the page itself gets scrolled through the point where the slim sign appears, to prove that scrolling
// never changes the page's height or throws the scroll position back (what trapped the iPhone in D1)
const SCROLL_STEPS = ['feed-quiet', 'greeting-long']
// name, query
export const SCENES = [
  ['greeting', 'scene=greeting'],
  ['greeting-long', 'scene=greeting&seen=never'],
  ['feed', 'scene=feed'],
  ['feed-quiet', 'scene=feed-quiet&seen=now'],
  ['scrolled', 'scene=scrolled'],
  ['signin', 'scene=signin&as=out'],
  ['sheet-movie', 'scene=sheet-movie'],
  ['form-results', 'scene=form-results'],
  ['empty', 'scene=empty&rows=empty&shelf=empty'],
  ['loading', 'scene=loading&shelf=slow&seen=now'],
  ['shelf-error', 'scene=shelf-error&shelf=fail&seen=now'],
  ['rail-all', 'scene=rail-all&seen=now'],
  ['posters-broken', 'scene=posters-broken&seen=now'],
  ['line', 'scene=line'],
  ['line-cate', 'scene=line&as=cate'],
  ['tray-open', 'scene=tray-open'],
  ['line-loading', 'scene=line-loading&rows=slow&seen=now'],
  ['line-error', 'scene=line-error&rows=fail&seen=now'],
  ['line-empty', 'scene=line-empty&rows=empty&seen=now'],
  ['stubs', 'scene=stubs&seen=now'],
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

// hard rule, browser layer (same as shoot.mjs): only reads leave the page
async function guard(context, blocked) {
  await context.route('**/*', (route) => {
    const r = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || r.url().startsWith(base)) return route.continue()
    blocked.push(`${r.method()} ${r.url()}`)
    return route.abort('blockedbyclient')
  })
}

async function open(browser, profile, query) {
  const context = await browser.newContext({ ...profile.device })
  const blocked = []
  await guard(context, blocked)
  const page = await context.newPage()
  await page.goto(`${base}?${query}`)
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 })
  const ready = await page.evaluate(() => window.__ready)
  return { context, page, ready, blocked }
}

// everything we measure, from inside the page
const measure = () => {
  const d = document.documentElement
  const meta = document.querySelector('meta[name=viewport]')?.content || ''
  const smallInputs = [...document.querySelectorAll('input, textarea, select')]
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => `${el.type || el.tagName.toLowerCase()} ${getComputedStyle(el).fontSize}`)
  // the widest thing on the page, to name the culprit if there's sideways overflow
  let widest = null
  if (d.scrollWidth > innerWidth) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.right > innerWidth + 0.5 && (!widest || r.right > widest.right)) widest = { right: Math.round(r.right), el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') }
    }
  }
  const greet = document.querySelector('.greet')
  const btn = document.querySelector('.greet .primary')
  const b = btn?.getBoundingClientRect()
  const vv = window.visualViewport
  return {
    innerWidth, innerHeight, scrollWidth: d.scrollWidth, scrollHeight: d.scrollHeight,
    vvWidth: vv?.width, vvHeight: vv?.height, vvScale: vv?.scale,
    meta, smallInputs, widest,
    // vertical only: overflow-x: clip on html and body is deliberate (no sideways scroll) and locks nothing
    htmlOverflow: getComputedStyle(d).overflowY, bodyOverflow: getComputedStyle(document.body).overflowY,
    bodyPosition: getComputedStyle(document.body).position,
    greeting: !!greet,
    greetScroll: greet ? { scrollHeight: greet.scrollHeight, clientHeight: greet.clientHeight, overflowY: getComputedStyle(greet).overflowY } : null,
    greetItems: document.querySelectorAll('.greet .reel-item').length,
    button: b ? { top: Math.round(b.top), bottom: Math.round(b.bottom) } : null,
  }
}

const problems = []
const report = {}
{
  const css = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(DIST, 'assets', f), 'utf8')).join('\n')
  // a bare-vh height is only allowed as a fallback, i.e. when the same rule also sets that property in dvh or svh
  const bad = []
  for (const [, body] of css.matchAll(/\{([^{}]*)\}/g)) {
    for (const [, prop, value] of body.matchAll(/(?:^|;)\s*((?:max-)?height|--[\w-]+)\s*:([^;]*\d(?:\.\d+)?vh\b[^;]*)/g)) {
      const companion = new RegExp(`(?:^|;)\\s*${prop.replace(/[-]/g, '\\-')}\\s*:[^;]*\\d(?:\\.\\d+)?[ds]vh\\b`)
      if (!companion.test(body)) bad.push(`${prop}:${value}`)
    }
  }
  if (bad.length) { problems.push(`css: heights in bare vh run under safari's toolbar on ios: ${bad.join(' | ')}`); console.log(`!!  css: ${bad.join(' | ')}`) }
  else console.log('ok  css: no bare-vh heights')
}
mkdirSync(OUT, { recursive: true })
for (const profile of PROFILES) {
  const browser = await profile.engine.launch()

  // the read-only guards prove themselves first, on this engine
  {
    const t = await open(browser, profile, 'scene=selftest')
    if (t.ready !== 'ok' || t.blocked.length !== 1) {
      console.log(`${profile.key}: selftest failed, nothing shot (${t.ready}, blocked ${t.blocked.length})`)
      process.exit(1)
    }
    await t.context.close()
    console.log(`${profile.key}: selftest ok`)
  }

  for (const [name, query] of SCENES.filter(([n]) => (!only.length || only.includes(n)) && (!profile.only || profile.only.includes(n)))) {
    const id = `${name}-${profile.key}`
    const { context, page, ready, blocked } = await open(browser, profile, query)
    const fail = (msg) => { problems.push(`${id}: ${msg}`); console.log(`!!  ${id}: ${msg}`) }
    let m = {}
    try {
      if (ready !== 'ok') fail(ready)
      if (blocked.length) fail(`blocked a write: ${blocked[0]}`)
      await page.screenshot({ path: join(OUT, `${id}.png`) })
      m = await page.evaluate(measure)
      report[id] = m

      if (m.scrollWidth > m.innerWidth) fail(`page is ${m.scrollWidth}px wide in a ${m.innerWidth}px viewport (widest: ${m.widest?.el} to ${m.widest?.right}px)`)
      if (/maximum-scale|user-scalable\s*=\s*(no|0)/i.test(m.meta)) fail(`viewport meta blocks zoom: ${m.meta}`)
      if (m.smallInputs.length) fail(`inputs under 16px zoom the page on focus in ios: ${m.smallInputs.join(', ')}`)

      // the line: every control at least 48px tall, and every stub on one line (64px, never wrapping)
      const line = await page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
        const small = [...document.querySelectorAll('.line-block button, .line-block a, main > .block .stub-row button')].filter(vis)
          .filter((e) => e.getBoundingClientRect().height < 47.5).map((e) => `"${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(e.getBoundingClientRect().height)}px`)
        const tall = [...document.querySelectorAll('.ticket-stub')].filter(vis).filter((e) => e.getBoundingClientRect().height > 72).map((e) => `${e.querySelector('.stub-title')?.textContent} ${Math.round(e.getBoundingClientRect().height)}px`)
        return { small, tall }
      })
      if (line.small.length) fail(`controls in the line under 48px: ${line.small.slice(0, 5).join(', ')}`)
      if (line.tall.length) fail(`stubs wrapping past one line: ${line.tall.slice(0, 5).join(', ')}`)

      // scroll stability: step the page down, each step must land exactly where it was sent, height never changing
      if (SCROLL_STEPS.includes(name) && m.scrollHeight > m.innerHeight + 700) {
        const s = await page.evaluate(async () => {
          const h0 = document.documentElement.scrollHeight
          const out = []
          for (const y of [40, 80, 100, 120, 125, 140, 160, 200, 260, 320, 400, 600, 400, 200, 120, 60, 0]) {
            scrollTo(0, y)
            await new Promise((r) => setTimeout(r, 200))
            out.push({ y, got: Math.round(scrollY), h: document.documentElement.scrollHeight })
          }
          return { h0, out }
        })
        const yanked = s.out.filter((o) => Math.abs(o.got - o.y) > 2)
        const resized = s.out.filter((o) => o.h !== s.h0)
        if (yanked.length) fail(`scrolling throws the page back: ${yanked.map((o) => `${o.y}->${o.got}`).join(', ')}`)
        if (resized.length) fail(`the page changes height while scrolling: ${s.h0} -> ${[...new Set(resized.map((o) => o.h))].join(', ')}`)
        await page.evaluate(() => scrollTo(0, 0))
        await page.waitForTimeout(200)
      }

      if (m.greeting) {
        // nothing may lock the page while the greeting is up
        const locked = /hidden|clip/.test(m.bodyOverflow) || /hidden|clip/.test(m.htmlOverflow) || m.bodyPosition === 'fixed'
        if (locked) fail(`the page is locked while the greeting is showing (html ${m.htmlOverflow}, body ${m.bodyOverflow}, body position ${m.bodyPosition})`)
        // the window fits the visible screen, and close and "got it" are both fully on screen, no scrolling needed
        const onScreen = async () => {
          const w = await page.locator('.greet').boundingBox()
          if (w.y < 0 || w.y + w.height > m.innerHeight + 0.5) fail(`the greeting window is taller than the screen (${Math.round(w.y)}..${Math.round(w.y + w.height)} in ${m.innerHeight})`)
          for (const [what, sel] of [['got it', '.greet .greet-foot .primary'], ['close', '.greet .greet-close']]) {
            const r = await page.locator(sel).boundingBox()
            if (!r) fail(`no "${what}" control on the greeting`)
            else if (r.y < 0 || r.y + r.height > m.innerHeight || r.height < 44) fail(`"${what}" is not fully on screen or too small to tap (${Math.round(r.y)}..${Math.round(r.y + r.height)} in ${m.innerHeight})`)
          }
        }
        await onScreen()
        // the whole list is there: every title the summary counts ("38 movies, 2 shows and an album" = 41)
        const counts = await page.evaluate(() => {
          const title = document.querySelector('.greet-title').textContent
          const said = [...title.matchAll(/\b(\d+|an?)\s+(movie|show|album)s?\b/g)].reduce((n, x) => n + (/^\d+$/.test(x[1]) ? +x[1] : 1), 0)
          const imgs = [...document.querySelectorAll('.greet .greet-list img')]
          return { said, listed: document.querySelectorAll('.greet .reel-item').length, imgs: imgs.length, lazy: imgs.filter((i) => i.loading === 'lazy').length }
        })
        if (counts.listed !== counts.said) fail(`the greeting says ${counts.said} but lists ${counts.listed}`)
        if (counts.imgs && counts.lazy !== counts.imgs) fail(`${counts.imgs - counts.lazy} of ${counts.imgs} greeting images are not lazy-loaded`)
        // scrolled to the very end, the last item is visible and both controls are still on screen
        const end = await page.evaluate(async () => {
          const l = document.querySelector('.greet .greet-list')
          l.scrollTop = l.scrollHeight
          await new Promise((r) => setTimeout(r, 300))
          const last = [...l.querySelectorAll('.reel-item')].pop()?.getBoundingClientRect()
          const box = l.getBoundingClientRect()
          const ok = !last || (last.bottom <= box.bottom + 1 && last.top >= box.top - 1)
          l.scrollTop = 0
          return ok
        })
        if (!end) fail('scrolled to the end, the last item in the greeting is still out of view')
        await onScreen()
        // android: real touch drags, on the list and on the backdrop
        if (profile.engine === chromium) {
          const cdp = await context.newCDPSession(page)
          const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
          const drag = async (x, y, d) => { await touch('touchStart', x, y); for (let k = 1; k <= 20; k++) await touch('touchMove', x, y + (d * k) / 20); await touch('touchEnd'); await page.waitForTimeout(400) }
          const list = await page.locator('.greet .greet-list').boundingBox()
          const overflows = await page.evaluate(() => { const l = document.querySelector('.greet .greet-list'); return l.scrollHeight > l.clientHeight })
          if (overflows) {
            await drag(list.x + list.width / 2, list.y + list.height - 20, -Math.min(300, list.height - 40))
            if (!(await page.evaluate(() => document.querySelector('.greet .greet-list').scrollTop))) fail('the greeting list does not scroll under a finger')
          }
          if (m.scrollHeight > m.innerHeight) {
            await drag(4, m.innerHeight - 60, -300)
            if (!(await page.evaluate(() => scrollY))) fail('a finger on the backdrop cannot scroll the page while the greeting is showing')
            await page.evaluate(() => scrollTo(0, 0))
          }
        }
        // and a real tap on "got it" closes it. on a fresh load: playwright's tap doesn't register after a raw
        // devtools touch sequence (a plain test page shows the same), so the drags above can't share a page with it
        if (profile.engine === chromium) { await page.reload(); await page.waitForFunction(() => window.__ready, null, { timeout: 30000 }) }
        await page.locator('.greet .greet-foot .primary').tap()
        await page.waitForTimeout(250)
        if (await page.locator('.greet').count()) fail('tapping "got it" did not close the greeting')
      }
    } catch (e) { fail(`scene threw: ${e.message.split(/\r?\n/)[0]}`) }
    console.log(`${problems.some((p) => p.startsWith(id)) ? '!! ' : 'ok '} ${id}  ${m.innerWidth ?? '?'}x${m.innerHeight ?? '?'} scrollWidth ${m.scrollWidth ?? '?'}${m.greeting ? `, greeting with ${m.greetItems} items, button at ${m.button?.top}..${m.button?.bottom}` : ''}`)
    await context.close()
  }
  await browser.close()
}

writeFileSync(join(OUT, 'mobile-report.json'), JSON.stringify(report, null, 1))
server.close()
if (problems.length) { console.log(`\n${problems.length} mobile problem(s):\n` + problems.join('\n')); process.exitCode = 1 }
else console.log('\nmobile checks passed')
