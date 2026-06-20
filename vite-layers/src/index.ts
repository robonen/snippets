export { defineLayerConfig, resolveLayerStack } from './config'
export { configWatchPlugin } from './dev'
export { FEATURE_MODULE, featurePlugin, featuresDts, flattenFeatures } from './features'
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
export {
  createLayeredResolution,
  DEFAULT_EXTENSIONS,
  layersResolver,
  type LayeredResolution,
  type LayersResolverOptions,
  type ParsedLayeredId,
  type ResolveRecord,
} from './resolve'
export { layersDevtoolsPlugin, type LayersDevtoolsData } from './devtools'
export { buildViteConfig, dedupePlugins, type BuildViteConfigOptions } from './kit'
export {
  generateTsConfig,
  writeTsConfig,
  tsconfigPlugin,
  type GenerateTsConfigOptions,
  type TSConfig,
} from './tsconfig'
export type { Layer, LayerConfig, LayerEdge, LayerStack } from './types'
