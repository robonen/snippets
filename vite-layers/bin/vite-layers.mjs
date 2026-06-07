#!/usr/bin/env node
// CLI for vite-layers. Loads the TypeScript source via jiti (no build step needed).
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createJiti } from 'jiti'

const here = dirname(fileURLToPath(import.meta.url))
const jiti = createJiti(import.meta.url)

const [cmd, appArg] = process.argv.slice(2)

if (cmd !== 'prepare') {
  console.error('Usage: vite-layers prepare [appDir]')
  process.exit(cmd ? 1 : 0)
}

const appDir = resolve(process.cwd(), appArg ?? '.')
const { writeTsConfig } = await jiti.import(resolve(here, '../src/tsconfig.ts'))
const file = await writeTsConfig(appDir)
console.log(`vite-layers: wrote ${file}`)
