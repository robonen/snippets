import { createHooks, type Hookable, type NestedHooks } from 'hookable'
import type { TSConfig } from 'pkg-types'
import type { ConfigEnv, UserConfig } from 'vite'
import type { Layer, LayerStack } from './types'

/** Hook handlers return nothing (mutation-style) — they may be async. */
export type HookResult = void | Promise<void>

export interface ViteConfigHookContext {
  /** The fully-assembled Vite config (mutate in place, or replace `.config`). */
  config: UserConfig
  env: ConfigEnv
  stack: LayerStack
}

export interface TsconfigHookContext {
  appDir: string
  /** The generated app/client tsconfig (mutate in place). */
  tsconfig: TSConfig
  /** The generated node tsconfig for config files (mutate in place). */
  nodeTsconfig: TSConfig
  stack: LayerStack
}

/**
 * Lifecycle hooks (powered by `hookable`, like Nuxt). Handlers run **serially in layer order —
 * base layers first** — and are **mutation-style**: they receive a shared argument and mutate it.
 */
export interface LayerHooks {
  /** After the stack is resolved and all hooks are registered. Mutate `stack` (merged/layers/features). */
  'layers:resolved': (stack: LayerStack) => HookResult
  /** The final Vite config, just before it is returned from `buildViteConfig`. */
  'vite:config': (ctx: ViteConfigHookContext) => HookResult
  /** The generated tsconfig, just before it is written. */
  'tsconfig:generate': (ctx: TsconfigHookContext) => HookResult
}

/** Declarative hook map accepted in `app.config.ts` (`hooks`) — supports nested/dotted keys. */
export type LayerHooksConfig = NestedHooks<LayerHooks>

export type LayerHookable = Hookable<LayerHooks>

/** Create an empty hookable instance for the layer lifecycle. */
export const createLayerHooks = (): LayerHookable => createHooks<LayerHooks>()

/**
 * Register each layer's `hooks` onto the hookable, **base layers first** (so higher-priority
 * layers' handlers run later), then the programmatic hooks last. Mirrors Nuxt's per-layer
 * `addHooks` loop: functions can't be deep-merged, so same-name handlers **accumulate** instead of
 * overwriting.
 *
 * @param layers stack layers ordered high→low priority (as returned by `resolveLayerStack`).
 */
export function registerLayerHooks(
  hooks: LayerHookable,
  layers: Pick<Layer, 'config'>[],
  programmatic?: LayerHooksConfig,
): void {
  for (const layer of [...layers].reverse()) {
    if (layer.config.hooks) hooks.addHooks(layer.config.hooks)
  }
  if (programmatic) hooks.addHooks(programmatic)
}

/** Build a hookable from a stack's layer-declared hooks (used when no shared instance is provided). */
export function hooksFromStack(layers: Pick<Layer, 'config'>[]): LayerHookable {
  const hooks = createLayerHooks()
  registerLayerHooks(hooks, layers)
  return hooks
}
