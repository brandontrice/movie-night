// Side-by-side contact sheet of two shot sets:  node design/compare.mjs before d0  -> design/shots/compare-before-d0.html
// Every scene in the second set, at every width either set has it at.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const [a = 'before', b = 'current'] = process.argv.slice(2)
const list = (set) => (existsSync(`design/shots/${set}`) ? readdirSync(`design/shots/${set}`) : [])
const parse = (f) => f.match(/^(.+)-(\d+)\.png$/)
const shotsB = list(b).map(parse).filter(Boolean)
const names = [...new Set(shotsB.map((m) => m[1]))].sort()
const widths = (n) => [...new Set([...list(a), ...list(b)].map(parse).filter((m) => m && m[1] === n).map((m) => +m[2]))].sort((x, y) => x - y)
const notes = (set) => (existsSync(`design/shots/${set}/notes.json`) ? JSON.parse(readFileSync(`design/shots/${set}/notes.json`, 'utf8')) : {})
const nA = notes(a), nB = notes(b)
const img = (set, n, w) => (existsSync(`design/shots/${set}/${n}-${w}.png`) ? `<img src="${set}/${n}-${w}.png" loading="lazy">` : '<div class="none">no shot</div>')
const fig = (set, n, w, nn) => `<figure><figcaption>${set} ${w}${nn[`${n}-${w}`] ? ': ' + nn[`${n}-${w}`] : ''}</figcaption>${img(set, n, w)}</figure>`
const rows = names.map((n) => `<section><h2>${n}</h2>${widths(n).map((w) =>
  `<div class="${w === 390 ? 'narrow' : 'wide'}">${fig(a, n, w, nA)}${fig(b, n, w, nB)}</div>`).join('')}</section>`).join('\n')
const out = `design/shots/compare-${a}-${b}.html`
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>${a} vs ${b}</title>
<style>body{background:#111;color:#ddd;font:14px system-ui;margin:24px}section{margin:0 0 56px}h2{font-size:18px}
.narrow,.wide{display:flex;gap:16px;margin:0 0 16px;align-items:flex-start}.narrow img{width:390px}.wide figure{flex:1}.wide img{width:100%}
figure{margin:0}figcaption{color:#999;margin:0 0 4px}img{border:1px solid #333;display:block}.none{color:#666;padding:40px}</style>
<h1>${a} vs ${b}</h1>${rows}`)
console.log(out)
