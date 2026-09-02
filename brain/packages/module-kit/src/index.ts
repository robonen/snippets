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

export { newId } from './id';
export { createIntent } from './intent';
export type { Intent } from './intent';
export { downloadText } from './download';

export { devicePeer, landId, wallClock } from './land';

export { openSpaces } from './spaces';
export type { OpenSpacesOptions, ShellLand, Spaces } from './spaces';

export { WidgetHost, createRegistry } from './registry';
export type { RegisteredCommand, RegisteredWidget, Registry } from './registry';

export { installBrain, useRegistry, useSpaces } from './context';
export type { Brain } from './context';
