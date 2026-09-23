// Builds the screenshot harness: the real app with src/lib/supabase.js swapped for the fixture-backed stub.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const slash = (p) => p.split('\\').join('/')
const real = slash(resolve(here, '../src/lib/supabase.js'))
const stub = resolve(here, 'harness/mock-supabase.js')

export default defineConfig({
  root: resolve(here, 'harness'),
  envDir: resolve(here, '..'),
  base: './',
  plugins: [
    react(),
    {
      name: 'harness-supabase',
      enforce: 'pre',
      async resolveId(id, importer) {
        if (!importer || !id.endsWith('lib/supabase')) return null
        const r = await this.resolve(id, importer, { skipSelf: true })
        return r && slash(r.id) === real ? stub : null
      },
    },
  ],
  build: { outDir: resolve(here, 'harness-dist'), emptyOutDir: true, target: 'es2022' },
})
