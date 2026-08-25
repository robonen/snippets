#!/usr/bin/env node
// CLI for vite-layers. In a source checkout it loads the TypeScript source via jiti (no build step
// needed); a published package ships `dist` (not `src`), so it falls back to the built `dist/index.js`.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const [cmd, appArg] = process.argv.slice(2)

if (cmd !== 'prepare') {
  console.error('Usage: vite-layers prepare [appDir]')
  process.exit(cmd ? 1 : 0)
}

const srcEntry = resolve(here, '../src/tsconfig.ts')
const { writeTsConfig } = existsSync(srcEntry)
  ? await (await import('jiti')).createJiti(import.meta.url).import(srcEntry)
  : await import(resolve(here, '../dist/index.js'))

const appDir = resolve(process.cwd(), appArg ?? '.')
const file = await writeTsConfig(appDir)
console.log(`vite-layers: wrote ${file}`)
