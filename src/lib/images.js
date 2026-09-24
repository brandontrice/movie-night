// artwork urls: where they come from and how big to ask for them
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// album art comes through the shelf function so navidrome credentials stay on the server
export const art = (u) => (u && u.startsWith('art:') ? `${SUPABASE_URL}/functions/v1/shelf?apikey=${encodeURIComponent(ANON)}&art=${encodeURIComponent(u.slice(4))}` : u)

const isJellyfin = (u) => !!u && u.includes('/Images/Primary')

// ask for about the pixels a slot shows at 2x, not the 450px-tall poster the shelf function asks for.
// jellyfin takes any maxHeight; tmdb has fixed widths (height is 1.5x). album art through the shelf proxy is fixed server-side.
const TMDB_W = [[138, 'w92'], [231, 'w154'], [278, 'w185'], [Infinity, 'w342']]
export function sized(u, h) {
  if (!u) return u
  if (isJellyfin(u)) return u.replace(/maxHeight=\d+/, `maxHeight=${h}`)
  if (u.includes('image.tmdb.org/t/p/w')) return u.replace(/\/t\/p\/w\d+\//, `/t/p/${TMDB_W.find(([max]) => h <= max)[1]}/`)
  return u
}

// jellyfin posters at several widths, so the browser picks by the slot's size and the screen's density.
// anything else (album art, tmdb) has one size and gets no srcset
const WIDTHS = [160, 320, 480, 640]
export const widthUrl = (u, w) => (isJellyfin(u) ? u.replace(/maxHeight=\d+/, `maxWidth=${w}`) : u)
export const srcSet = (u) => (isJellyfin(u) ? WIDTHS.map((w) => `${widthUrl(u, w)} ${w}w`).join(', ') : undefined)
