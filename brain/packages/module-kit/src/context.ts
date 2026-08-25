import { inject } from 'vue';
import type { App, InjectionKey } from 'vue';
import type { Registry } from './registry';
import type { Spaces } from './spaces';

/**
 * Символьные ключи, а не строки: два экземпляра кита в одном приложении обязаны
 * столкнуться громко, на типах, а не молча передать друг другу чужой реестр.
 */
const SPACES: InjectionKey<Spaces> = Symbol('brain.spaces');
const REGISTRY: InjectionKey<Registry> = Symbol('brain.registry');

export interface Brain {
  readonly spaces: Spaces;
  readonly registry: Registry;
}

/** Отдать пространство модулей приложению — в `main.ts`, до `mount`. */
export function installBrain(app: App, brain: Brain): void {
  app.provide(SPACES, brain.spaces);
  app.provide(REGISTRY, brain.registry);
}

export function useSpaces(): Spaces {
  return need(SPACES, 'пространства не собраны: вызовите installBrain(app, …) до mount');
}

export function useRegistry(): Registry {
  return need(REGISTRY, 'реестр не собран: вызовите installBrain(app, …) до mount');
}

function need<T>(key: InjectionKey<T>, message: string): T {
  const value = inject(key);
  if (value === undefined) throw new Error(message);
  return value;
}
