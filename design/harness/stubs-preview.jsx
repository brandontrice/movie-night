// Harness-only: every state a stub can be in, on real request rows, with each state passed straight in.
// The live scenes may never press imported, nevermind or sure? (the read-only rule), so this is where the
// scanning, not-yet, confirm and leaving states get reviewed. Animations are frozen so the shot is the state.
import data from '../fixture/data.json'
import LineStub from '../../src/LineStub'

const reqs = data.requests
const waiting = reqs.filter((r) => r.status !== 'imported')
const longest = [...reqs].sort((a, b) => b.title.length - a.title.length)[0]
const album = reqs.find((r) => r.type === 'album')
const [a, b, c, d, e, f, g] = waiting
const noop = () => {}

const rows = [
  ['at rest, someone else\'s (admit one)', { r: a }],
  ['at rest, one you can act on', { r: b, canImport: true, canPull: true }],
  ['tray open', { r: c, canImport: true, canPull: true, trayOpen: true }],
  ['scanning the shelf', { r: d, canImport: true, canPull: true, trayOpen: true, scanning: true, slowAfter: 1e9 }],
  ['still looking (after 8 seconds of scanning)', { r: e, canImport: true, canPull: true, trayOpen: true, scanning: true, slowAfter: 0 }],
  ['not on the shelf yet', { r: f, canImport: true, canPull: true, trayOpen: true, missed: true }],
  ['confirm: sure? or keep it', { r: g, canImport: true, canPull: true, trayOpen: true, pulling: true }],
  ['cate\'s own, confirm (no imported for her)', { r: a, canPull: true, trayOpen: true, pulling: true }],
  ['imported: the stamp lands before it folds away', { r: b, leaving: 'shelf' }],
  ['an old "grabbed" row', { r: { ...c, status: 'grabbed' } }],
  ['the longest real title', { r: { ...longest, status: 'requested' }, canImport: true, canPull: true }],
  ['an album (real row, shown waiting)', { r: { ...album, status: 'requested' } }],
  ['no poster', { r: { ...d, poster_url: null } }],
]

export default function StubsPreview() {
  return (
    <main className="queue stubs-preview">
      <style>{'.stubs-preview .stub-row, .stubs-preview .stub-tray, .stubs-preview .stamp { animation: none !important; }'}</style>
      <p className="hint dim" style={{ margin: '0 0 8px' }}>harness preview: real rows, each state passed in directly</p>
      <section className="block line-block" style={{ maxWidth: 420 }}>
        <div className="sec-head"><h2 className="sec-title">stub states</h2><span className="sec-rule" /></div>
        <ul className="line">
          {rows.map(([label, p], i) => (
            <div key={i} style={{ display: 'contents' }}>
              <p className="hint dim" style={{ margin: '6px 0 0' }}>{label}</p>
              <LineStub {...p} r={{ ...p.r, id: `${p.r.id}-${i}` }} onOpen={noop} onToggleTray={noop} onImported={noop} onAskPull={noop} onKeep={noop} onPull={noop} />
            </div>
          ))}
        </ul>
      </section>
    </main>
  )
}
