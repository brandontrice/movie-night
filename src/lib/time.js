// "just now", "5m ago", "3h ago", "2d ago", then a date
export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 7) return `${Math.floor(d)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

// the local calendar day something happened on, as a key ("2026-09-18")
export function dayKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// how the program names a day: "today", "yesterday", a weekday for this past week, then "sep 18"
export function dayLabel(iso) {
  const days = Math.round((dayStart(Date.now()) - dayStart(new Date(iso))) / 864e5)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return new Date(iso).toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase()
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase()
}
