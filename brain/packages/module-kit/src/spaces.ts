import { Land, createSpace, idbStore, openVault, randomSession, syncTabs } from '@sync/core';
import type { Clock, LandId, Link, ModelName, Space, UnitStore } from '@sync/core';
import type { OpenVault } from '@brain/auth';
import { devicePeer, landId, wallClock } from './land';
import { idbChest, sealedStore } from './sealed';
import type { Chest, SealedStore } from './sealed';
import type { BrainModule } from './module';

/**
 * Сборка пространств: по ленду на модуль плюс связь между ними.
 *
 * Мост `@sync/vue` намеренно не прячет эти строки у одноленового приложения
 * (ADR-018) — здесь их столько же, просто в цикле. Что действительно добавляет
 * кит поверх — это `open`: пространство одного модуля умеет открыть соседнее,
 * и на этом держатся ссылки `[[…]]` через границы модулей.
 *
 * ─── Почему ленды открываются В ДВА ЗАХОДА ──────────────────────────────────
 *
 * Мета-ленд лежит на диске ОТКРЫТЫМ: в нём обёрнутые копии ключа, и они обязаны
 * читаться до того, как ключ появился, — иначе курица и яйцо. Все остальные
 * ленды запечатаны, и открыть их нечем, пока замок не снят.
 *
 * Отсюда форма: `openSpaces` поднимает только мета-ленд и возвращается сразу —
 * оболочка успевает показать экран замка, пока данных ещё нет и быть не может.
 * Модульные ленды приезжают в {@link Spaces.unseal}, а {@link Spaces.seal}
 * убирает их обратно: заперто — значит расшифрованного в памяти вкладки нет.
 */

/**
 * Открытый ленд. Внутренняя запись сборки: наружу отдаётся только `Space`.
 *
 * Две карты держат одну и ту же запись с разных сторон — по имени модуля и по
 * адресу ленда, — поэтому владельца видно по обеим.
 */
interface LandHandle {
  /** Идентификатор модуля, чей это ленд. */
  readonly id: string;
  readonly space: Space;
}

/** Системный ленд оболочки: настройки и обёртки ключа — то, что не принадлежит модулю. */
export interface SystemLand {
  readonly root: ModelName;
  readonly seed?: (space: Space) => void;
}

/**
 * Ленд оболочки, который шифруется наравне с модульными.
 *
 * Отдельно от {@link SystemLand} потому, что различие не в хозяине, а в том,
 * лежит ленд на диске текстом или шифртекстом. Инбокс — пользовательские данные
 * (пойманные мысли и ссылки), и оставить их рядом с обёртками ключа значило бы
 * сделать работу наполовину.
 */
export interface ShellLand {
  readonly id: string;
  readonly seed?: (space: Space) => void;
}

/** Имя системного ленда. Оболочка — такой же владелец ленда, как модуль. */
export const SYSTEM_ID = 'meta';

export interface Spaces {
  /**
   * Пространство модуля или ленда оболочки. Бросает на незнакомом имени — это
   * опечатка, не данные, — и на ещё запечатанном ленде.
   */
  space(moduleId: string): Space;
  /** Пространство мета-ленда. Бросает, если системный ленд не заказан. */
  system(): Space;
  /** Модуль, которому принадлежит ленд. Для показа ссылок на чужие сущности. */
  ownerOf(land: LandId): string | undefined;
  /** Открыты ли шифрованные ленды: до снятия замка их нет. */
  readonly open: boolean;
  /** Распечатать ленды модулей и оболочки. Зовётся после снятия замка. */
  unseal(vault: OpenVault): Promise<void>;
  /** Убрать их обратно: дописать несохранённое и забыть расшифрованное. */
  seal(): Promise<void>;
  close(): void;
}

export interface OpenSpacesOptions {
  readonly modules: readonly BrainModule[];
  /**
   * Мета-ленд. Отдельный от модулей по той же причине, по которой ленды вообще
   * разделены, плюс одна своя: он единственный лежит на диске открытым, потому
   * что несёт обёртки ключа.
   */
  readonly system?: SystemLand;
  /** Ленды оболочки, которые шифруются наравне с модульными, — инбокс. */
  readonly shell?: readonly ShellLand[];
  /**
   * Хранилище ОТКРЫТЫХ лендов: в нём живёт только мета-ленд. По умолчанию —
   * IndexedDB `brain`.
   */
  readonly store?: UnitStore;
  /** Носитель запечатанных лендов. По умолчанию — IndexedDB `brain-sealed`. */
  readonly chest?: Chest;
  /** Идентичность устройства. По умолчанию — из localStorage. */
  readonly peer?: Link;
  readonly clock?: Clock;
  /** Канал вкладок. По умолчанию включён — выключается в тестах. */
  readonly tabs?: boolean;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
  readonly report?: (error: unknown) => void;
}

const DB_NAME = 'brain';

export async function openSpaces(options: OpenSpacesOptions): Promise<Spaces> {
  const { modules, report } = options;
  const clock = options.clock ?? wallClock;
  const peer = options.peer ?? devicePeer(options.storage ?? localStorage);
  const plain = options.store ?? idbStore({ name: DB_NAME });
  const withTabs = options.tabs ?? true;
  // Сундук заводится ЛЕНИВО, при первом распечатывании: до снятия замка он не
  // нужен, а `idbChest()` в среде без IndexedDB бросает сразу — и уронил бы
  // сборку, которой шифрованные ленды могут вовсе не понадобиться.
  let chest: Chest | null = options.chest ?? null;

  const byModule = new Map<string, LandHandle>();
  const byLand = new Map<string, LandHandle>();
  /** Как закрыть открытое: мета-ленд отдельно от шифрованных — их снимают порознь. */
  const closers: Array<() => void> = [];
  const sealedClosers: Array<() => void> = [];
  let sealed: SealedStore | null = null;

  /**
   * Соседний ленд. Ищется ЛЕНИВО, в момент вызова: модули открываются циклом, и
   * ссылка вперёд — на модуль, до которого цикл ещё не дошёл, — обязана
   * работать так же, как ссылка назад.
   */
  const open = (at: LandId): Space => {
    const found = byLand.get(at.str);
    if (found === undefined) {
      throw new Error(
        `ленд «${at.str}» не открыт: ссылка ведёт в модуль, которого нет в сборке`,
      );
    }
    return found.space;
  };

  /** Поднять набор лендов на одном хранилище. Общее для открытого и запечатанного. */
  const mount = async (
    entries: ReadonlyArray<{ id: string; seed?: (space: Space) => void }>,
    store: UnitStore,
    stop: Array<() => void>,
  ): Promise<void> => {
    const opened: Array<Promise<void>> = [];

    for (const entry of entries) {
      // Ленд оболочки и модуль с одним именем писали бы в один ленд, а карта
      // молча оставила бы последнего — столкновение обязано быть громким.
      if (byModule.has(entry.id)) {
        throw new Error(`имя «${entry.id}» занято другим лендом сборки: выберите другое`);
      }
      const at = landId(entry.id);
      // Сеанс — свой у КАЖДОГО одновременно живого ленда (ADR-017): общий сеанс
      // означал бы одинаковые id юнитов в разных лендах одного устройства.
      const land = new Land(peer, clock, { session: randomSession() });
      const vault = openVault({ store, id: at, land, ...(report && { report }) });
      const space = createSpace({ land, id: at, ready: vault.ready, open });

      const handle: LandHandle = { id: entry.id, space };
      byModule.set(entry.id, handle);
      byLand.set(at.str, handle);

      stop.push(() => {
        // Сначала дописать, потом отписаться: сохранение идёт в микрозадаче, и
        // закрытие без `save()` теряет правки последнего кадра — ровно те, что
        // пользователь сделал перед уходом со страницы.
        vault.save();
        vault.close();
        byModule.delete(entry.id);
        byLand.delete(at.str);
      });
      if (withTabs) {
        const tabs = syncTabs({ land, id: at, ...(report && { report }) });
        stop.push(() => {
          tabs.close();
        });
      }
      opened.push(vault.opened());
    }

    await Promise.all(opened);

    // Посев — только после гидрации: до неё ленд пуст не потому, что новый, а
    // потому, что данные ещё едут, и «пусто — сею» посеяло бы поверх своего же.
    for (const entry of entries) {
      const handle = byModule.get(entry.id);
      if (handle !== undefined) entry.seed?.(handle.space);
    }
  };

  if (options.system !== undefined) {
    await mount(
      [{ id: SYSTEM_ID, ...(options.system.seed && { seed: options.system.seed }) }],
      plain,
      closers,
    );
  }

  const unwind = (stop: Array<() => void>): void => {
    // В обратном порядке: канал вкладок снимается раньше хранилища, иначе
    // пришедшая пачка успеет записаться в уже закрытый vault.
    for (const close of stop.toReversed()) close();
    stop.length = 0;
  };

  return {
    space: moduleId => spaceOf(byModule, moduleId, sealed !== null).space,
    system: () => {
      const found = byModule.get(SYSTEM_ID);
      if (found === undefined) {
        throw new Error('системный ленд не заказан: передайте `system` в openSpaces');
      }
      return found.space;
    },
    ownerOf: at => byLand.get(at.str)?.id,
    get open(): boolean {
      return sealed !== null;
    },

    async unseal(vault: OpenVault): Promise<void> {
      if (sealed !== null) return;
      chest ??= idbChest();
      // Хранилище заводится своё на каждое открытие: в нём лежит расшифрованный
      // образ каждого ленда, и переживать замок он не имеет права.
      const store = sealedStore({ vault, chest });
      sealed = store;
      try {
        await mount(
          [
            ...(options.shell ?? []).map(land => ({
              id: land.id,
              ...(land.seed && { seed: land.seed }),
            })),
            ...modules.map(module => ({
              id: module.id,
              ...(module.land.seed && { seed: module.land.seed }),
            })),
          ],
          store,
          sealedClosers,
        );
      }
      catch (error) {
        // Полуоткрытая сборка хуже закрытой: экран показал бы часть модулей и
        // посеял бы поверх непрочитанного.
        unwind(sealedClosers);
        sealed = null;
        throw error;
      }
    },

    async seal(): Promise<void> {
      if (sealed === null) return;
      const store = sealed;
      sealed = null;
      unwind(sealedClosers);
      // Дождаться, пока дописанное действительно уедет в сундук: ключ забывают
      // сразу после этого вызова, а запечатать пачку без ключа нельзя.
      await store.settled();
    },

    close() {
      unwind(sealedClosers);
      sealed = null;
      unwind(closers);
    },
  };
}

function spaceOf(
  byModule: ReadonlyMap<string, LandHandle>,
  moduleId: string,
  unsealed: boolean,
): LandHandle {
  const found = byModule.get(moduleId);
  if (found === undefined) {
    if (!unsealed) {
      throw new Error(
        `ленд «${moduleId}» ещё запечатан: пространства модулей появляются после снятия замка`,
      );
    }
    throw new Error(`модуль «${moduleId}» не собран: пространства у него нет`);
  }
  return found;
}
