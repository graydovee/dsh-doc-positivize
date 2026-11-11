import { defineConfig } from 'tsdown'

// tsdown bundles src/index.ts into lib/index.js (ESM) and emits lib/index.d.ts.
// It is also the self-contained `prepare` script for git installs: no project
// references, no type checking (see guide §7.1 "build-script catch").
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
