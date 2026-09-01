import type { Component } from 'vue';
import type { RouteLocationRaw, RouteRecordRaw } from 'vue-router';
import type { Link, ModelName, Space } from '@sync/core';

/**
 * Декларация модуля — единственная точка связи оболочки и модуля.
 *
 * Оболочка не знает про модули ничего сверх этого объекта, модули не знают друг
 * про друга ничего вовсе: связь между ними идёт только ссылками на сущности
 * (`Link` адресует через границы лендов) и через контракт.
 *
 * Хуки, которых здесь пока нет намеренно: `resolveRef`, `calendar`,
 * `reminders`, `review`. Они появятся вместе со своими экранами (стадии Э7 и
 * Э8) — тип, написанный вслепую под ненаписанный экран, всё равно
 * переписывается, а до тех пор врёт про готовность.
 */
export interface BrainModule {
  /**
   * Короткое имя латиницей: префикс маршрутов (`/kcal/…`), префикс имён моделей
   * (`kcal/food`) и материал для адреса ленда. Меняется только вместе с
   * переездом данных — из него отчеканен адрес.
   */
  readonly id: string;
  /** Имя для навигации и палитры. */
  readonly title: string;
  readonly icon?: Component;
  readonly land: ModuleLand;
  /**
   * Маршруты модуля с ОТНОСИТЕЛЬНЫМИ путями: оболочка сама вешает их под
   * `/<id>` и оборачивает хостом, который отдаёт вниз пространство модуля.
   */
  readonly routes: readonly RouteRecordRaw[];
  /** Карточки на экране «Сегодня». */
  readonly widgets?: readonly ModuleWidget[];
  /** Команды палитры и разбора инбокса. */
  readonly commands?: readonly ModuleCommand[];
  /** Выдача модуля в глобальный поиск. */
  readonly search?: (ctx: ModuleContext, query: string) => readonly SearchHit[];
  /**
   * Узнаёт ли модуль свой синтаксис в строке быстрого захвата.
   *
   * Хук существует, чтобы оболочка НЕ знала, что «250 кофе» — это трата, а
   * «купить молока !высокий» — задача. Разбор живёт там же, где домен;
   * стартовый экран лишь показывает предложения и вызывает `run`. Без этого
   * поле захвата пришлось бы учить синтаксису каждого модуля, и добавление
   * модуля правило бы оболочку.
   */
  readonly capture?: (ctx: ModuleContext, text: string) => CaptureMatch | null;
}

export interface ModuleLand {
  /** Корневая модель ленда. Имя уже с префиксом модуля — см. `scoped`. */
  readonly root: ModelName;
  /**
   * Первое наполнение. Зовётся один раз после гидрации ленда, поэтому обязано
   * быть идемпотентным по СОДЕРЖИМОМУ: «ленд пуст — сеем» проверяет модуль сам,
   * иначе повторный запуск на непустом ленде посеет дубли.
   */
  readonly seed?: (space: Space) => void;
}

/** Что модуль получает в хуках: своё пространство и своё имя. */
export interface ModuleContext {
  readonly id: string;
  readonly space: Space;
}

export interface ModuleWidget {
  readonly id: string;
  readonly title: string;
  readonly component: Component;
  /** Меньше — выше на экране «Сегодня». По умолчанию 100. */
  readonly order?: number;
}

export interface ModuleCommand {
  readonly id: string;
  readonly title: string;
  /** Дополнительные слова для нечёткого поиска по палитре. */
  readonly keywords?: readonly string[];
  readonly icon?: Component;
  /**
   * Выполнить. Возвращает адрес, куда вести человека, — как и `run` у
   * {@link CaptureMatch}, и по той же причине.
   *
   * Без возврата команда была невидимой: «Новая заметка», позванная из закладок,
   * молча заводила заметку в чужом ленде и оставляла человека на месте — со
   * стороны неотличимо от того, что команда не сработала, и повторные нажатия
   * копили пустые заметки. У задач и закладок было хуже: они поднимают
   * заявку, которую забирает СВОЙ экран при монтировании, а раз экран не открыт,
   * забирать её было некому — не происходило вообще ничего.
   *
   * Роутер модулям при этом не выдаётся: адрес — это данные, и решение «вести или
   * нет» остаётся у оболочки, которая одна знает про историю и про то, открыта ли
   * уже нужная страница.
   */
  readonly run: (ctx: ModuleContext) =>
    | RouteLocationRaw | void
    | Promise<RouteLocationRaw | void>;
}

export interface SearchHit {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly to: RouteLocationRaw;
  /** Адрес сущности, если на неё можно сослаться из текста. */
  readonly at?: Link;
}

/** Предложение модуля по введённой строке. */
export interface CaptureMatch {
  /** Что получится: «Трата 250 ₽ — кофе». */
  readonly title: string;
  /** Уточнение справа: категория, срок, проект. */
  readonly hint?: string;
  /** Создать. Возвращает адрес созданного, если на него можно перейти. */
  readonly run: () => RouteLocationRaw | void;
}

/**
 * Объявить модуль. Тождественная функция: она нужна ради вывода типов и ради
 * одного места, куда смотреть в поисках декларации.
 */
export function defineModule(module: BrainModule): BrainModule {
  return module;
}

/**
 * Префикс имён моделей: `scoped('kcal')('food')` → `'kcal/food'`.
 *
 * Реестр `Models` в `@sync/core` один на приложение, а модули пишутся
 * независимо — без префикса два модуля рано или поздно объявят `note` или
 * `entry` и молча склеят схемы. Тип возвращает литерал-шаблон, поэтому
 * `declare module '@sync/core'` в модуле обязан назвать тот же префикс.
 */
export function scoped<Id extends string>(id: Id): <N extends string>(name: N) => `${Id}/${N}` {
  return name => `${id}/${name}`;
}
