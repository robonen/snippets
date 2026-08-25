import { defineComponent, h } from 'vue';
import { RouterView } from 'vue-router';
import type { Component, PropType } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import { useSpaces } from './context';
import { landId } from './land';
import { SYSTEM_ID } from './spaces';
import type { BrainModule, ModuleCommand, ModuleWidget } from './module';
import { provideSpace } from '@sync/vue';

/**
 * Реестр модулей: проверки набора и сборка того, что оболочка показывает
 * пользователем — маршрутов, виджетов «Сегодня» и команд палитры.
 *
 * Проверки живут ЗДЕСЬ, а не в `defineModule`, потому что все они про набор, а
 * не про отдельный модуль: уникальность имён и уникальность отчеканенных
 * адресов лендов невозможно проверить, глядя на один модуль.
 */

export interface Registry {
  readonly modules: readonly BrainModule[];
  get(id: string): BrainModule;
  routes(): RouteRecordRaw[];
  widgets(): readonly RegisteredWidget[];
  commands(): readonly RegisteredCommand[];
}

export interface RegisteredWidget {
  readonly module: BrainModule;
  readonly widget: ModuleWidget;
}

export interface RegisteredCommand {
  readonly module: BrainModule;
  readonly command: ModuleCommand;
}

const ID_SHAPE = /^[a-z][a-z0-9-]{0,15}$/;
const DEFAULT_ORDER = 100;

export function createRegistry(modules: readonly BrainModule[]): Registry {
  const byId = new Map<string, BrainModule>();
  const byLand = new Map<string, string>();

  for (const module of modules) {
    if (!ID_SHAPE.test(module.id)) {
      throw new Error(
        `имя модуля «${module.id}» не годится: строчная латиница, цифры и дефис, до 16 символов — `
        + 'из имени чеканится адрес ленда и строятся пути маршрутов',
      );
    }
    if (module.id === SYSTEM_ID) {
      throw new Error(`имя «${SYSTEM_ID}» занято лендом оболочки: выберите другое`);
    }
    if (byId.has(module.id)) {
      throw new Error(`модуль «${module.id}» объявлен дважды`);
    }
    const at = landId(module.id).str;
    const owner = byLand.get(at);
    if (owner !== undefined) {
      // Адрес чеканится повтором имени по кругу (см. `land.ts`), поэтому
      // столкновение — это период: `ab` и `abab` дают один адрес. Разойтись
      // молча они не могут: два модуля писали бы в один ленд.
      throw new Error(
        `модули «${owner}» и «${module.id}» чеканят один адрес ленда «${at}»: переименуйте один из них`,
      );
    }
    byId.set(module.id, module);
    byLand.set(at, module.id);
  }

  const list = [...modules];

  return {
    modules: list,
    get(id) {
      const found = byId.get(id);
      if (found === undefined) throw new Error(`модуль «${id}» не зарегистрирован`);
      return found;
    },
    routes: () => list.map(moduleRoute),
    widgets: () => list
      .flatMap(module => (module.widgets ?? []).map(widget => ({ module, widget })))
      .sort((a, b) => (a.widget.order ?? DEFAULT_ORDER) - (b.widget.order ?? DEFAULT_ORDER)),
    commands: () => list
      .flatMap(module => (module.commands ?? []).map(command => ({ module, command }))),
  };
}

/**
 * Оправа для виджета модуля на чужом экране.
 *
 * Виджет объявлен модулем, а рисуется оболочкой — на «Сегодня». Без оправы он
 * оказывается вне хоста своего модуля, и первый же `useDoc()` падает: инъекции
 * пространства в этом месте дерева нет.
 *
 * Виджет создаётся ЗДЕСЬ, в рендере оправы, а не приходит слотом. Разница
 * принципиальная: содержимое слота принадлежит тому, кто его написал, и
 * `inject` внутри слота ищет провайдера у ВЫЗЫВАЮЩЕГО, а не у оправы. Слотовая
 * версия выглядела бы правильнее и не работала бы.
 */
export const WidgetHost = defineComponent({
  name: 'widget-host',
  props: {
    module: { type: String, required: true },
    // `Object` И `Function`: компонент бывает функциональным, а проверка одним
    // лишь `Object` ругалась бы на него в консоли — при том, что рисуется он
    // как обычный.
    component: { type: [Object, Function] as PropType<Component>, required: true },
  },
  setup(props) {
    const spaces = useSpaces();
    // `provide` отрабатывает один раз за монтирование, поэтому список виджетов
    // обязан иметь ключ вида `модуль:виджет` — иначе Vue переиспользует
    // инстанс под другой модуль и отдаст вниз чужое пространство.
    provideSpace(spaces.space(props.module));
    return () => h(props.component);
  },
});

/**
 * Маршрут модуля: путь `/<id>`, а под ним — хост, отдающий вниз пространство
 * модуля. Дальше экраны модуля зовут `useDoc()` из `@sync/vue` как в
 * одноленовом приложении и про мультиленд не знают вовсе.
 */
function moduleRoute(module: BrainModule): RouteRecordRaw {
  return {
    path: `/${module.id}`,
    component: moduleHost(module),
    children: [...module.routes],
    meta: { module: module.id, title: module.title },
  };
}

/**
 * Хост — СВОЙ компонент на каждый модуль, а не один с пропом.
 *
 * Разница не косметическая: `provide` отрабатывает один раз за монтирование, и
 * при переходе `/kcal` → `/notes` Vue переиспользовал бы один и тот же
 * инстанс, оставив вниз пространство прежнего модуля. Разные типы компонентов
 * гарантируют перемонтирование.
 */
function moduleHost(module: BrainModule): Component {
  return defineComponent({
    name: `${module.id}-host`,
    setup() {
      const spaces = useSpaces();
      provideSpace(spaces.space(module.id));
      return () => h(RouterView);
    },
  });
}
