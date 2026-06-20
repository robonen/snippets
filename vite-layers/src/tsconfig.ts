import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { defu } from 'defu'
import { type TSConfig, writeTSConfig } from 'pkg-types'
import type { Plugin } from 'vite'
import { resolveLayerStack } from './config'
import { FEATURE_MODULE, featuresDts } from './features'
import { hooksFromStack, type LayerHookable } from './hooks'
import type { LayerStack } from './types'
import { toPosix } from './util'

export type { TSConfig } from 'pkg-types'

/** Absolute path (no extension) to the `feature` macro entry — mapped to `#feature` in `paths`. */
const FEATURE_FILE = resolve(import.meta.dirname, 'feature')

export interface GenerateTsConfigOptions {
  /**
   * Extra tsconfig merged over the per-layer `tsConfig` and the generated defaults (defu — this
   * wins). Does NOT override the generated `paths`, which always reflect the resolved layer stack.
   */
  tsConfig?: TSConfig
  /** Extra tsconfig merged over the generated **node** config (for config files). */
  nodeTsConfig?: TSConfig
  /** Directory to write into, relative to `appDir`. Default: `.vite-layers`. */
  outDir?: string
  /** Reuse an already-resolved stack (avoids a second `resolveLayerStack` per build). Internal. */
  stack?: LayerStack
  /** Shared hooks instance; if absent, one is built from the stack's layer hooks. Internal. */
  hooks?: LayerHookable
}

/** A path not already starting with `.` — {@link rel} prefixes it with `./`. */
const LEADING_NON_DOT_RE = /^([^.])/
/** Port of Nuxt's `relativeWithDot`: guarantees a leading `./`, returns `.` for the self case. */
const rel = (from: string, to: string) => toPosix(relative(from, to)).replace(LEADING_NON_DOT_RE, './$1') || '.'

/** Framework-neutral compiler defaults (a subset of Nuxt's, minus Vue/JSX specifics). */
const DEFAULT_COMPILER_OPTIONS: TSConfig['compilerOptions'] = {
  target: 'ESNext',
  module: 'ESNext',
  moduleResolution: 'Bundler',
  esModuleInterop: true,
  skipLibCheck: true,
  resolveJsonModule: true,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  strict: true,
  noUncheckedIndexedAccess: true,
  forceConsistentCasingInFileNames: true,
  allowImportingTsExtensions: true,
  noEmit: true,
}

/**
 * Defaults for the node-environment config (`vite.config`/`app.config`): node-side, **no DOM lib**,
 * **no layered `paths`** (config files don't use `@/`). Mirrors Nuxt's `tsconfig.node.json`.
 */
const NODE_COMPILER_OPTIONS: TSConfig['compilerOptions'] = {
  ...DEFAULT_COMPILER_OPTIONS,
  lib: ['ESNext'],
  paths: {},
}

/**
 * Build the auto-generated tsconfig for an app's layer stack — a framework-agnostic port of Nuxt's
 * `_generateTypes` (`@nuxt/kit` `packages/kit/src/template.ts`).
 *
 * The defining difference: because `@/` and `~/` are *layered* here (first-match across every
 * layer's `srcDir`, see {@link layersResolver}), `paths['@/*']` is the array of ALL layer srcDirs in
 * priority order. TypeScript resolves path arrays by first existing file, so `tsc` mirrors the
 * runtime resolver exactly. (No `baseUrl` — deprecated in TS 6; since TS 5.0 `paths` resolve
 * relative to the config that defines them, so a consuming tsconfig that `extends` this one
 * resolves the relative paths from here.)
 *
 * Customize via each layer's `app.config.ts` `tsConfig` field (merged across the stack, like Nuxt's
 * `typescript.tsConfig`) and/or `opts.tsConfig` (highest priority). Both are typed as pkg-types
 * {@link TSConfig}.
 */
export async function generateTsConfig(appDir: string, opts: GenerateTsConfigOptions = {}) {
  const stack = opts.stack ?? (await resolveLayerStack(appDir))
  const { merged, layers } = stack
  const genDir = resolve(appDir, opts.outDir ?? '.vite-layers')

  const srcStar = layers.map(l => `${rel(genDir, l.srcDir)}/*`) // [high … low]
  const projectRoot = layers[0]!.rootDir
  const paths: Record<string, string[]> = {
    '@/*': srcStar,
    '~/*': srcStar,
    '~~': [rel(genDir, projectRoot)],
    '@@': [rel(genDir, projectRoot)],
    '~~/*': [`${rel(genDir, projectRoot)}/*`],
    '@@/*': [`${rel(genDir, projectRoot)}/*`],
    // `#feature` → the macro entry, so tsc/vue-tsc resolve `import { feature } from '#feature'` and
    // the generated `features.d.ts` augmentation. Matches the alias buildViteConfig registers.
    [FEATURE_MODULE]: [rel(genDir, FEATURE_FILE)],
  }
  for (const l of layers) {
    // first-wins on duplicate names, mirroring the `#layers/<name>` alias in buildViteConfig.
    const star = `#layers/${l.name}/*`
    if (star in paths) continue
    paths[`#layers/${l.name}`] = [rel(genDir, l.rootDir)]
    paths[star] = [`${rel(genDir, l.rootDir)}/*`]
  }

  const exclude = [rel(genDir, resolve(appDir, 'node_modules')), rel(genDir, resolve(appDir, 'dist'))]

  // App/client config: layer src trees + the typed `feature()` flags (features.d.ts). Config files
  // are NOT here — they belong to the node config below.
  const base: TSConfig = {
    compilerOptions: { ...DEFAULT_COMPILER_OPTIONS },
    include: ['./features.d.ts', ...layers.map(l => `${rel(genDir, l.srcDir)}/**/*`)],
    exclude,
  }

  // Precedence (defu, first wins): opts.tsConfig → per-layer merged.tsConfig → generated defaults.
  // `paths` is applied last — it is generated, not overridable.
  const tsconfig = defu(opts.tsConfig, merged.tsConfig, base) as TSConfig
  tsconfig.compilerOptions = { ...tsconfig.compilerOptions, paths }

  // Node config: `vite.config`/`app.config` of every layer, node-side typings, no DOM, no paths.
  const nodeBase: TSConfig = {
    compilerOptions: { ...NODE_COMPILER_OPTIONS },
    include: layers.flatMap((l) => {
      const r = rel(genDir, l.rootDir)
      return [`${r}/app.config.*`, `${r}/vite.config.*`]
    }),
    exclude,
  }
  const nodeTsconfig = defu(opts.nodeTsConfig, nodeBase) as TSConfig

  // Escape hatch: let layer/programmatic hooks mutate the generated tsconfigs before they're written.
  const ctx = { appDir, tsconfig, nodeTsconfig, stack }
  await (opts.hooks ?? hooksFromStack(layers)).callHook('tsconfig:generate', ctx)

  return {
    tsconfig: ctx.tsconfig, // a hook may have mutated or replaced it
    file: resolve(genDir, 'tsconfig.json'),
    nodeTsconfig: ctx.nodeTsconfig,
    nodeFile: resolve(genDir, 'tsconfig.node.json'),
    genDir,
    dts: featuresDts(merged.features),
    dtsFile: resolve(genDir, 'features.d.ts'),
  }
}

/**
 * Generate and write `<appDir>/.vite-layers/{tsconfig.json,features.d.ts}` (tsconfig via pkg-types
 * `writeTSConfig`). Returns the tsconfig path.
 */
export async function writeTsConfig(appDir: string, opts?: GenerateTsConfigOptions): Promise<string> {
  const { tsconfig, file, nodeTsconfig, nodeFile, genDir, dts, dtsFile } = await generateTsConfig(appDir, opts)
  await mkdir(genDir, { recursive: true })
  await Promise.all([
    writeTSConfig(file, tsconfig),
    writeTSConfig(nodeFile, nodeTsconfig),
    writeFile(dtsFile, dts),
  ])
  return file
}

/**
 * Vite plugin that writes the generated tsconfig on `configResolved` (dev + build) — the
 * framework-agnostic analogue of Nuxt's automatic `prepare:types`.
 */
export function tsconfigPlugin(appDir: string, opts?: GenerateTsConfigOptions): Plugin {
  return {
    name: 'vite-layers:tsconfig',
    async configResolved() {
      await writeTsConfig(appDir, opts)
    },
  }
}
