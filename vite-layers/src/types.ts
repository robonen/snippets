import type { TSConfig } from 'pkg-types'
import type { ConfigEnv, UserConfig } from 'vite'
import type { LayerHooksConfig } from './hooks'

/**
 * A layer's declarative config, authored in `app.config.ts`.
 * Mirrors the subset of Nuxt's layer config relevant to a framework-agnostic build.
 */
export interface LayerConfig {
  /** Explicit layer name; used for the `#layers/<name>` alias. Falls back to the dir basename. */
  name?: string
  /** Absolute/relative root dir of the layer. Defaults to the layer's own directory. */
  rootDir?: string
  /** Source dir, resolved against `rootDir`. Default: `'src'`. */
  srcDir?: string
  /** Layers to extend: relative path, npm package, or git source (resolved by c12). */
  extends?: string | string[]
  /** Vite config fragment contributed by this layer (object or env-aware factory). */
  vite?: UserConfig | ((env: ConfigEnv) => UserConfig)
  /** Build-time feature flags, exposed to app code as the `__FEATURES__` global. */
  features?: Record<string, unknown>
  /**
   * tsconfig overrides contributed by this layer, merged across the stack into the generated
   * `.vite-layers/tsconfig.json` (analogue of Nuxt's `typescript.tsConfig`). The generated
   * `paths` always win. Typed as pkg-types {@link TSConfig}.
   */
  tsConfig?: TSConfig
  /**
   * Lifecycle hooks (hookable). Accumulated across layers (base-first), not deep-merged — so
   * same-name handlers from multiple layers all run. See {@link LayerHooks}.
   */
  hooks?: LayerHooksConfig
  /** c12 layer metadata; `$meta.name` takes precedence when deriving the layer name. */
  $meta?: { name?: string }
  /** Overrides applied when the resolved env (Vite `mode`) is `development`. */
  $development?: Partial<LayerConfig>
  /** Overrides applied when the resolved env (Vite `mode`) is `production`. */
  $production?: Partial<LayerConfig>
  /** Overrides keyed by env name (Vite `mode`), e.g. `{ staging: { features: {…} } }`. */
  $env?: Record<string, Partial<LayerConfig>>
}

/** A fully resolved layer in the stack. */
export interface Layer {
  /** Absolute root directory of the layer. */
  rootDir: string
  /** Absolute source directory (`rootDir`/`srcDir`). */
  srcDir: string
  /** Resolved layer name. */
  name: string
  /** The layer's own (unmerged) config. */
  config: LayerConfig
}

export interface LayerStack {
  /** Deep-merged config across the whole stack (defu, project wins). */
  merged: LayerConfig
  /** Layers ordered high→low priority; `layers[0]` is the project itself. */
  layers: Layer[]
}
