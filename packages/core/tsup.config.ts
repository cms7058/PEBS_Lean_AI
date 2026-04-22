import { defineConfig } from 'tsup'

// Never clean: UI is built into dist/ui/ and we don't want tsup to wipe it.
// Run `pnpm clean` explicitly to reset dist/.
export default defineConfig([
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'node18',
  },
])
