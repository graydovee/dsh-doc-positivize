import { defineConfig } from 'tsdown'

// tsdown bundles src/index.ts into lib/index.js (ESM) and emits lib/index.d.ts.
// It runs from `build` and from `prepack` (npm/tarball), with no project
// references and no type checking (see guide §7.1 "build-script catch").
// `lib/` is committed so a `git` install ships the built entry points: the
// package declares no install-time build script, so pnpm never needs a build
// permission to add it from GitHub.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  // The package is `"type": "module"`, so `fixedExtension: false` emits
  // `index.js` / `index.d.ts` — the names package.json#main/types point at.
  // The node-platform default emits `index.mjs` / `index.d.mts`.
  fixedExtension: false,
  clean: true,
  sourcemap: false,
  outDir: 'lib',
})
