export { defineLayerConfig, resolveLayerStack } from './config'
export { configWatchPlugin, featuresRuntimePlugin } from './dev'
export { publicLayersPlugin } from './public'
export {
  createLayerHooks,
  registerLayerHooks,
  hooksFromStack,
  type HookResult,
  type LayerHookable,
  type LayerHooks,
  type LayerHooksConfig,
  type TsconfigHookContext,
  type ViteConfigHookContext,
} from './hooks'
export { DEFAULT_EXTENSIONS, layersResolver, type LayersResolverOptions } from './resolve'
export { buildViteConfig, dedupePlugins, type BuildViteConfigOptions } from './kit'
export {
  generateTsConfig,
  writeTsConfig,
  tsconfigPlugin,
  featuresDts,
  type GenerateTsConfigOptions,
  type TSConfig,
} from './tsconfig'
export type { Layer, LayerConfig, LayerStack } from './types'
