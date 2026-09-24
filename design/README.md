# design harness

Screenshots of every view and state at 390 (phone, 2x) and 1440 (desktop), from the **real app on real
data**, without signing in. Every design phase ends with a before/after set from here.

How it works: `vite.config.js` builds `src/App.jsx` and `src/index.css` unchanged, with one swap:
`src/lib/supabase.js` is replaced by `harness/mock-supabase.js`, which answers from
`fixture/data.json`. The clock is frozen at capture time, so the date-seeded now showing shuffle,
the "3d ago" stamps and the 72-hour new tags come out the same in the before and the after.

From the repo root:

```bash
node design/capture-data.mjs                       # read-only: tables over ssh, edge functions over http
npx vite build --config design/vite.config.js
node design/shoot.mjs before                       # every scene -> design/shots/before/ + index.html
node design/shoot.mjs p1 feed sheet-movie          # just the named scenes -> design/shots/p1/
REDUCED=1 node design/shoot.mjs p1-reduced feed    # with prefers-reduced-motion: reduce
node design/compare.mjs before p1                  # side by side -> design/shots/compare-before-p1.html
node design/mobile.mjs p1-mobile                   # real mobile: must end "mobile checks passed"
```

Open `design/shots/<label>/index.html` for the contact sheet. **Re-capturing data changes the
pictures**, so capture once at the start of a phase and shoot before and after from the same fixture.

- `assets/before.css` is the stylesheet as deployed before the design work started (commit `6db2d1f`,
  `index-mAPm2wWv.css`). To re-shoot the true "before", check that commit out in a worktree and run
  the harness there.
- **Read-only, always.** No scene presses nevermind, sure?, imported, delete or sign out; four guards enforce it and
  `shoot.mjs` runs a self-test of all four before every set (details in AGENTS.md, section 5).
- Scenes live in `harness/main.jsx` (what to click), the scene list and widths in `shoot.mjs`.
  Data knobs are URL params read by `harness/mock-supabase.js`: `as=brandon|cate|out`,
  `shelf=ok|slow|fail|empty`, `rows=ok|empty`, `details=ok|slow|fail`, `lookup=ok|slow`,
  `seen=now`.
- Chrome or Edge is found automatically (`CHROME=` overrides) for `shoot.mjs`.

## real mobile (required every phase)

`shoot.mjs`'s 390 shots are desktop Chrome told to act like a phone: blink, not webkit, no touch, and pictures
only, nothing tapped or scrolled. That is how an ios-only trap got past it (Sep 2026: a greeting sized in `vh`
ran under safari's address bar with the page locked behind it). `mobile.mjs` uses Playwright (a dev dependency;
`npx playwright install webkit chromium` once per machine) with real device profiles: webkit as an iPhone 15,
chromium as a Pixel 7 and a 320px Galaxy S9+. It shoots each scene as `<scene>-iphone.png` and so on, and fails if:

- the page is wider than the viewport, or the viewport meta blocks zoom
- any text input is under 16px (ios zooms the page in on focus)
- the built css sizes a height in bare `vh` with no `dvh`/`svh` companion
- with the greeting open: the page is locked, close or "got it" isn't fully on screen, a finger can't scroll the
  list or the page (android: real touch drags), or a tap on "got it" doesn't close it

It runs the same read-only self-test first, and blocks non-GET requests through Playwright's router.
`DIST=<other harness-dist>` points it at another build, e.g. an older commit's, to show a before.
- `fixture/`, `shots/` and `harness-dist/` are gitignored: the fixture is household data, and
  the shots regenerate.
