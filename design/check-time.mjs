// Checks src/lib/time.js the way the app uses it: day labels and day grouping, in a given time zone, at a given "now".
//   TZ=America/New_York node design/check-time.mjs
// Fails (exit 1) if a label breaks the rule: "today", "yesterday", a bare weekday only for 2 to 6 days back
// (so never today's own weekday), a date for anything older; and if grouping follows UTC instead of local time.
import { dayLabel, dayKey } from '../src/lib/time.js'

const RealNow = Date.now
const at = (iso, fn) => { const t = new Date(iso).getTime(); Date.now = () => t; try { return fn() } finally { Date.now = RealNow } }
const problems = []
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// two "nows": the harness's frozen capture time, and the day this was checked on
for (const now of ['2026-09-23T23:32:17Z', '2026-09-24T16:00:00Z']) {
  const rows = []
  at(now, () => {
    const today = new Date(Date.now())
    for (let back = 0; back <= 9; back++) {
      const d = new Date(today); d.setDate(d.getDate() - back); d.setHours(14, 0, 0, 0)
      const label = dayLabel(d.toISOString())
      rows.push(`${String(back).padStart(2)}d back  ${d.toDateString()}  -> ${label}`)
      const expect = back === 0 ? 'today' : back === 1 ? 'yesterday' : back <= 6 ? WEEKDAYS[d.getDay()] : null
      if (expect && label !== expect) problems.push(`${now}: ${back}d back should be "${expect}", got "${label}"`)
      if (!expect && WEEKDAYS.includes(label)) problems.push(`${now}: ${back}d back is a bare weekday "${label}", should be a date`)
      if (back > 0 && label === WEEKDAYS[today.getDay()]) problems.push(`${now}: "${label}" reads as today`)
    }
  })
  console.log(`now = ${new Date(now).toString()}`)
  for (const r of rows) console.log('  ' + r)
}

// grouping follows the device's local time: 9:30 pm eastern on monday sep 21 is 01:30 utc tuesday
const late = '2026-09-22T01:30:00Z'
const key = dayKey(late)
const label = at('2026-09-23T23:32:17Z', () => dayLabel(late))
console.log(`\n${late} (9:30 pm eastern, monday) groups under ${key} "${label}" in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`)
if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York' && (key !== '2026-09-21' || label !== 'monday')) problems.push(`9:30 pm eastern should group under 2026-09-21 "monday", got ${key} "${label}"`)

if (problems.length) { console.log('\n' + problems.join('\n')); process.exitCode = 1 } else console.log('\ntime checks passed')
