// npm run deploy                 build, upload a fresh release, switch to it atomically, verify, prune
// npm run deploy -- --rollback   point the site back at the previous release
//
// nginx serves /home/btrice9595/movie-night. That path is a symlink into ~/movie-night-releases/<stamp>-<hash>,
// so a deploy never mixes old and new files, every old bundle goes away with its release, and a rollback is one
// rename. The newest KEEP releases stay on disk. The first run moves the old flat directory (and its pile of stale
// bundles) into the releases folder as "legacy", where it ages out like any other release.
import { execFileSync, execSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'

const HOST = 'btrice9595@192.168.1.118'
const SITE = '/home/btrice9595/movie-night'
const RELEASES = '/home/btrice9595/movie-night-releases'
const URL = 'http://192.168.1.118:8081/'
const KEEP = 3

const ssh = (script) => execFileSync('ssh', ['-o', 'BatchMode=yes', HOST, 'bash -se'], { input: `set -euo pipefail\n${script}` }).toString().trim()
const git = (args) => execSync(`git ${args}`).toString().trim()

// switch the site symlink to a release. rename(2) over the old link is atomic; the one-time conversion from a real
// directory has a sub-millisecond gap between two renames, which is the only non-atomic moment this script has.
const switchTo = (release) => `
mkdir -p ${RELEASES}
if [ -d ${SITE} ] && [ ! -L ${SITE} ]; then mv ${SITE} ${RELEASES}/0-legacy; fi
ln -sfn ${RELEASES}/${release} ${SITE}.next
mv -T ${SITE}.next ${SITE}
readlink ${SITE}`

if (process.argv.includes('--rollback')) {
  const current = ssh(`basename "$(readlink ${SITE})"`)
  const all = ssh(`ls -1 ${RELEASES}`).split('\n').sort()
  const prev = all[all.indexOf(current) - 1]
  if (!prev) throw new Error(`nothing older than ${current} to roll back to`)
  console.log(`rolling back ${current} -> ${prev}`)
  console.log(ssh(switchTo(prev)))
  process.exit(0)
}

// what's going out, and whether it matches a commit
const hash = git('rev-parse --short HEAD')
const dirty = git('status --porcelain') !== ''
if (dirty) console.log('heads up: the working tree has uncommitted changes. commit and push this build right after, so the live site stays a build of origin/main.')

execSync('npm run build', { stdio: 'inherit' })
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
const release = `${stamp}-${hash}${dirty ? '-dirty' : ''}`
writeFileSync('dist/release.txt', `${release}\n`)
const built = readdirSync('dist/assets').filter((f) => /^index-.*\.(js|css)$/.test(f)).sort()

// upload into a release folder nobody is serving yet
ssh(`mkdir -p ${RELEASES}/${release}`)
execFileSync('scp', ['-q', '-r', ...readdirSync('dist').map((f) => `dist/${f}`), `${HOST}:${RELEASES}/${release}/`], { stdio: 'inherit' })
ssh(`chmod -R u=rwX,go=rX ${RELEASES}/${release}`)

console.log(`live: ${ssh(switchTo(release))}`)

// the served page has to point at exactly the bundle we just built
const served = [...new Set((await (await fetch(URL, { cache: 'no-store' })).text()).match(/index-[\w-]+\.(js|css)/g))].sort()
if (served.join() !== built.join()) throw new Error(`served ${served.join(', ')} but built ${built.join(', ')}`)
const live = (await (await fetch(`${URL}release.txt`, { cache: 'no-store' })).text()).trim()
if (live !== release) throw new Error(`release.txt says ${live}, expected ${release}`)
console.log(`verified: ${served.join(', ')}`)

// prune: keep the newest KEEP releases, never the live one
const pruned = ssh(`cd ${RELEASES}; live=$(basename "$(readlink ${SITE})"); ls -1 | sort | head -n -${KEEP} | while read r; do [ "$r" != "$live" ] && rm -rf -- "$r" && echo "$r"; done || true`)
if (pruned) console.log(`pruned: ${pruned.split('\n').join(', ')}`)
