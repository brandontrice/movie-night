// Harness-only: poster case variants the real rail can't show yet, on real fixture rows.
// Albums never reach now showing (it only picks movies and shows), but the greeting and the shelf will reuse the
// case, so the album sleeve is reviewed here, now. Also: a lead title card and a watched case.
import data from '../fixture/data.json'
import PosterCase from '../../src/PosterCase'
import { art } from '../../src/lib/images'

const items = (data.shelf?.items ?? []).map((i) => ({ ...i, id: i.key, poster_url: art(i.poster_url) }))
const albums = items.filter((i) => i.type === 'album' && i.poster_url).slice(0, 4)
const movie = items.find((i) => i.type === 'movie' && i.title.length > 40) ?? items.find((i) => i.type === 'movie')
const watched = { ...items.filter((i) => i.type === 'movie')[3], played: true }

export default function CasesPreview() {
  return (
    <main className="queue">
      <p className="hint dim" style={{ margin: '0 0 8px' }}>harness preview: real rows, laid out by hand</p>
      <section className="block now">
        <div className="sec-head"><h2 className="sec-title">album sleeves</h2><span className="sec-rule" /></div>
        <ul className="cases">
          {albums.map((r, i) => <li key={r.id} className={i === 0 ? 'lead' : ''}><PosterCase r={r} lead={i === 0} index={i} /></li>)}
        </ul>
      </section>
      <section className="block now">
        <div className="sec-head"><h2 className="sec-title">title cards and a seen stamp</h2><span className="sec-rule" /></div>
        <ul className="cases">
          <li className="lead"><PosterCase r={{ ...movie, poster_url: null }} lead index={0} /></li>
          <li><PosterCase r={{ ...movie, poster_url: null }} index={1} /></li>
          <li><PosterCase r={{ ...albums[1], poster_url: null }} index={2} /></li>
          <li><PosterCase r={watched} index={3} /></li>
        </ul>
      </section>
    </main>
  )
}
