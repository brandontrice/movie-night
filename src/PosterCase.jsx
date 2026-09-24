import { useState } from 'react'
import { srcSet, widthUrl } from './lib/images'

// how wide each kind of case is drawn at each breakpoint, so the browser fetches the right poster width
const SIZES = {
  lead: '(min-width: 1024px) 285px, (min-width: 760px) 180px, 168px',
  small: '(min-width: 1024px) 133px, (min-width: 760px) 128px, 120px',
  wallLead: '(min-width: 1024px) 285px, (min-width: 760px) 40vw, 66vw',
  wallSmall: '(min-width: 1024px) 133px, (min-width: 760px) 20vw, 33vw',
}

/* a poster in a lit case: gilt edge, black mat, glass, a lamp in the top of the case and a pool of light below.
   no poster, or one that fails to load, becomes a title card; an album gets a square sleeve with its record showing.
   the whole case is one link (play it) or, with nowhere to play, a button that opens the detail sheet */
export default function PosterCase({ r, lead = false, wall = false, index = 0, onOpen }) {
  const [broken, setBroken] = useState(false)
  const album = r.type === 'album'
  const showArt = r.poster_url && !broken
  const label = `${r.play_url ? 'play ' : ''}${r.title}${r.year ? `, ${r.year}` : ''}${album && r.artist ? `, ${r.artist}` : ''}${r.played ? ', seen' : ''}`
  const cls = 'case' + (lead ? ' lead' : '') + (album ? ' album' : '') + (r.played ? ' watched' : '') + (showArt ? '' : ' carded')

  const body = (
    <>
      {lead && <span className="case-plate" aria-hidden="true">tonight</span>}
      <span className="case-glass">
        {album && <span className="case-record" aria-hidden="true" />}
        <span className="case-mat">
          {showArt ? (
            <img
              src={widthUrl(r.poster_url, lead ? 480 : 320)}
              srcSet={srcSet(r.poster_url)}
              sizes={SIZES[(wall ? 'wall' : '') + (lead ? (wall ? 'Lead' : 'lead') : wall ? 'Small' : 'small')]}
              alt=""
              width={lead ? 285 : 133}
              height={album ? (lead ? 285 : 133) : lead ? 428 : 200}
              loading={index < 3 ? 'eager' : 'lazy'}
              fetchPriority={index === 0 ? 'high' : undefined}
              decoding="async"
              onError={() => setBroken(true)}
            />
          ) : (
            <span className="title-card" aria-hidden="true">
              <span className="tc-title">{r.title}</span>
              {r.year && <span className="tc-year">{r.year}</span>}
            </span>
          )}
        </span>
        {r.played && <span className="case-seen" aria-hidden="true">seen</span>}
      </span>
      <span className="case-caption" aria-hidden="true">
        <span className="case-title">{r.title}</span>
        {album && r.artist ? <span className="case-sub">{r.artist}</span> : r.year ? <span className="case-sub">{r.year}</span> : null}
      </span>
    </>
  )
  return r.play_url
    ? <a className={cls} href={r.play_url} target="_blank" rel="noreferrer" aria-label={label}>{body}</a>
    : <button type="button" className={cls} onClick={() => onOpen?.(r)} aria-label={label}>{body}</button>
}

// the same cases, unlit: what the rail looks like while the shelf is still answering
export function CaseSkeletons({ n }) {
  return Array.from({ length: n }, (_, i) => (
    <li key={i} className={i === 0 ? 'lead' : ''}>
      <span className={'case skeleton' + (i === 0 ? ' lead' : '')} aria-hidden="true">
        {i === 0 && <span className="case-plate">tonight</span>}
        <span className="case-glass"><span className="case-mat" /></span>
        <span className="case-caption"><span className="case-title">&nbsp;</span></span>
      </span>
    </li>
  ))
}
