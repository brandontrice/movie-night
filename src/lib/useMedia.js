import { useSyncExternalStore } from 'react'

// true while a media query matches; follows the window as it resizes
export function useMedia(query) {
  return useSyncExternalStore(
    (on) => { const m = matchMedia(query); m.addEventListener('change', on); return () => m.removeEventListener('change', on) },
    () => matchMedia(query).matches,
    () => false,
  )
}
