// Side-by-side contact sheet of two shot sets:  node design/compare.mjs before d0  -> design/shots/compare-before-d0.html
import { existsSync, readdirSync, writeFileSync } from 'node:fs'

const [a = 'before', b = 'current'] = process.argv.slice(2)
const names = [...new Set(readdirSync(`design/shots/${b}`).filter((f) => f.endsWith('.png')).map((f) => f.replace(/-(390|1440)\.png$/, '')))].sort()
const img = (set, n, w) => existsSync(`design/shots/${set}/${n}-${w}.png`) ? `<img src="${set}/${n}-${w}.png" loading="lazy">` : '<div class="none">no shot</div>'
const rows = names.map((n) => `<section><h2>${n}</h2>
<div class="w390"><figure><figcaption>${a}</figcaption>${img(a, n, 390)}</figure><figure><figcaption>${b}</figcaption>${img(b, n, 390)}</figure></div>
<div class="w1440"><figure><figcaption>${a}</figcaption>${img(a, n, 1440)}</figure><figure><figcaption>${b}</figcaption>${img(b, n, 1440)}</figure></div></section>`).join('\n')
const out = `design/shots/compare-${a}-${b}.html`
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>${a} vs ${b}</title>
<style>body{background:#111;color:#ddd;font:14px system-ui;margin:24px}section{margin:0 0 56px}h2{font-size:18px}
.w390,.w1440{display:flex;gap:16px;margin:0 0 16px;align-items:flex-start}.w390 img{width:390px}.w1440 figure{flex:1}.w1440 img{width:100%}
figure{margin:0}figcaption{color:#999;margin:0 0 4px}img{border:1px solid #333;display:block}.none{color:#666;padding:40px}</style>
<h1>${a} vs ${b}</h1>${rows}`)
console.log(out)
