/**
 * `@brain/module-kit` — контракт между оболочкой и модулями.
 *
 * Слой намеренно тонкий: он объявляет, ЧТО модуль обязан отдать оболочке, и
 * умеет ровно три вещи, которые модуль сделать не может, — отчеканить адрес
 * ленда, собрать пространства и связать их между собой.
 */

export { defineModule, scoped } from './module';
export type {
  BrainModule,
  CaptureMatch,
  ModuleCommand,
  ModuleContext,
  ModuleLand,
  ModuleWidget,
  SearchHit,
} from './module';

export { useToday } from './today';

export { landId } from './land';

export { SYSTEM_ID, openSpaces } from './spaces';
export type { OpenSpacesOptions, ShellLand, Spaces, SystemLand } from './spaces';

export { idbChest, isOpenPack, memoryChest, reseal, sealExisting, sealedStore } from './sealed';
export type {
  Chest,
  IdbChestOptions,
  ResealOptions,
  SealExistingOptions,
  SealedStore,
  SealedStoreOptions,
} from './sealed';

export { tappedChest } from './tapped-chest';
export type { ChestTap } from './tapped-chest';

export { WidgetHost, createRegistry } from './registry';
export type { RegisteredCommand, RegisteredWidget, Registry } from './registry';

export { installBrain, useRegistry, useSpaces } from './context';
export type { Brain } from './context';
