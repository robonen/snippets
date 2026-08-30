import { shallowRef } from 'vue';
import { CryptoError, Land, createSpace, idbStore, openVault, randomSession, sealedStore, syncTabs } from '@sync/core';
import type { Clock, LandId, Link, SecretRing, Space, UnitStore } from '@sync/core';
import { devicePeer, landId, wallClock } from './land';
import type { BrainModule } from './module';

/**
 * Сборка пространств: по ленду на модуль плюс связь между ними.
 *
 * Мост `@sync/vue` намеренно не прячет эти строки у одноленового приложения
 * (ADR-018) — здесь их столько же, просто в цикле. Что действительно добавляет
 * кит поверх — это `open`: пространство одного модуля умеет открыть соседнее,
 * и на этом держатся ссылки `[[…]]` через границы модулей.
 *
 * ─── Шифрование здесь — одна строка ──────────────────────────────────────────
 *
 * Payload юнитов запечатывает само ядро (`sealedStore` из `@sync/core`), ключи
 * подаёт связка (`SecretRing`). Прежних двух заходов — «открытый мета-ленд,
 * потом остальные по ключу» — больше нет: обёртки ключей живут вне лендов
 * (`security/keys.ts`), поэтому ВСЕ ленды поднимаются одинаково и только после
 * снятия замка. Заперто — значит `unseal` ещё не звали или `seal` уже отзвали:
 * расшифрованных лендов в памяти вкладки нет.
 */

/** Открытый ленд. Внутренняя запись сборки: наружу отдаётся только `Space`. */
interface LandHandle {
  /** Идентификатор модуля, чей это ленд. */
  readonly id: string;
  readonly space: Space;
}

/** Ленд оболочки — инбокс и служебные. Шифруется ли он, решает связка ключей. */
export interface ShellLand {
  readonly id: string;
  readonly seed?: (space: Space) => void;
}

export interface Spaces {
  /**
   * Пространство модуля или ленда оболочки. Бросает на незнакомом имени — это
   * опечатка, не данные, — и на ещё запечатанном ленде.
   */
  space(moduleId: string): Space;
  /** Модуль, которому принадлежит ленд. Для показа ссылок на чужие сущности. */
  ownerOf(land: LandId): string | undefined;
  /** Ленд модуля — синхронизации нужен доступ к `Land.apply`/`tap`. */
  landOf(moduleId: string): Land;
  /** Подняты ли ленды: до снятия замка их нет. */
  readonly open: boolean;
  /** Поднять ленды по связке ключей. Зовётся после снятия замка. */
  unseal(ring: SecretRing): Promise<void>;
  /**
   * Стереть ленды с носителя. Только под замком (`seal` уже отзвали):
   * присоединение к чужому пространству заменяет локальные данные его копией.
   */
  wipe(ids: readonly string[]): Promise<void>;
  /** Убрать их: дописать несохранённое, дождаться носителя и забыть открытое. */
  seal(): Promise<void>;
  close(): Promise<void>;
}

export interface OpenSpacesOptions {
  readonly modules: readonly BrainModule[];
  /** Ленды оболочки — инбокс и служебные. */
  readonly shell?: readonly ShellLand[];
  /** Внутреннее хранилище ПОД печатью. По умолчанию — IndexedDB `brain-lands`. */
  readonly store?: UnitStore;
  /** Идентичность устройства. По умолчанию — из localStorage. */
  readonly peer?: Link;
  readonly clock?: Clock;
  /** Канал вкладок. По умолчанию включён — выключается в тестах. */
  readonly tabs?: boolean;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
  readonly report?: (error: unknown) => void;
}

/** База запечатанных лендов. */
const DB_NAME = 'brain-lands';

export function openSpaces(options: OpenSpacesOptions): Spaces {
  const { modules, report } = options;
  const clock = options.clock ?? wallClock;
  const peer = options.peer ?? devicePeer(options.storage ?? localStorage);
  const withTabs = options.tabs ?? true;

  const inner = options.store ?? idbStore({ name: DB_NAME });

  const byModule = new Map<string, LandHandle>();
  const byLand = new Map<string, LandHandle>();
  const lands = new Map<string, Land>();
  const closers: Array<() => void> = [];
  /** Записи носителя, начатые сборкой: `seal` обязан их дождаться до забвения ключа. */
  let settling = new Set<Promise<unknown>>();
  // Реактивный, а не переменная: присоединение к пространству пересобирает
  // ленды посреди жизни вкладки (seal → wipe → unseal), и «v-if="spaces.open"»
  // обязан проснуться, когда они поднимутся снова.
  const opened = shallowRef(false);

  /**
   * Соседний ленд. Ищется ЛЕНИВО, в момент вызова: модули открываются циклом, и
   * ссылка вперёд — на модуль, до которого цикл ещё не дошёл, — обязана
   * работать так же, как ссылка назад.
   */
  const open = (at: LandId): Space => {
    const found = byLand.get(at.str);
    if (found === undefined) {
      throw new Error(`land «${at.str}» is not open: the link leads to a module absent from the build`);
    }
    return found.space;
  };

  /**
   * Хранилище со следом незавершённых записей. Ключ забывается сразу после
   * `seal`, а запись идёт микрозадачей — без ожидания последняя пачка легла бы
   * в носитель уже без ключа.
   */
  /**
   * Невосстановимый образ не должен окирпичивать сборку: ленд, запечатанный
   * ключами, которых в связке больше нет (localStorage стёрт, профиль
   * восстановлен частично), — мусор ПО ПОСТРОЕНИЮ, его не открыть ничем.
   * Такой образ сбрасывается с предупреждением, ленд поднимается пустым, а
   * данные возвращаются обычным синком после подключения устройства.
   */
  const resilient = (store: UnitStore): UnitStore => ({
    ...store,
    async load(land) {
      try {
        return await store.load(land);
      }
      catch (error) {
        if (!(error instanceof CryptoError)) throw error;
        console.warn(
          `[brain] land ${land.str} image cannot be opened by the keyring — dropping it, data returns over sync`,
          error,
        );
        report?.(error);
        await store.drop(land);
        return store.load(land);
      }
    },
  });

  const tracked = (store: UnitStore): UnitStore => ({
    load: land => store.load(land),
    save(land, pack) {
      const done = Promise.resolve(store.save(land, pack));
      settling.add(done);
      done.catch(() => undefined).finally(() => settling.delete(done));
      return done;
    },
    ball: (land, shot) => store.ball(land, shot),
    drop: land => store.drop(land),
    lands: () => store.lands(),
  });

  const unwind = (): void => {
    // В обратном порядке: канал вкладок снимается раньше хранилища, иначе
    // пришедшая пачка успеет записаться в уже закрытый vault.
    for (const close of closers.toReversed()) close();
    closers.length = 0;
    byModule.clear();
    byLand.clear();
    lands.clear();
    opened.value = false;
  };

  return {
    space: moduleId => handleOf(byModule, moduleId, opened.value).space,
    ownerOf: at => byLand.get(at.str)?.id,
    landOf: (moduleId) => {
      const found = lands.get(moduleId);
      if (found === undefined) throw new Error(`land «${moduleId}» is not up`);
      return found;
    },
    get open(): boolean {
      return opened.value;
    },

    async unseal(ring: SecretRing): Promise<void> {
      if (opened.value) return;
      const store = tracked(resilient(sealedStore(inner, ring)));

      const entries = [
        ...(options.shell ?? []).map(land => ({ id: land.id, ...(land.seed && { seed: land.seed }) })),
        ...modules.map(module => ({ id: module.id, ...(module.land.seed && { seed: module.land.seed }) })),
      ];

      try {
        const hydrating: Array<Promise<void>> = [];
        for (const entry of entries) {
          // Ленд оболочки и модуль с одним именем писали бы в один ленд, а
          // карта молча оставила бы последнего — столкновение обязано быть громким.
          if (byModule.has(entry.id)) {
            throw new Error(`name «${entry.id}» is taken by another land of the build: pick a different one`);
          }
          const at = landId(entry.id);
          // Сеанс — свой у КАЖДОГО одновременно живого ленда (ADR-017): общий
          // сеанс означал бы одинаковые id юнитов в разных лендах устройства.
          const land = new Land(peer, clock, { session: randomSession() });
          const vault = openVault({ store, id: at, land, ...(report && { report }) });
          const space = createSpace({ land, id: at, ready: vault.ready, open });

          const handle: LandHandle = { id: entry.id, space };
          byModule.set(entry.id, handle);
          byLand.set(at.str, handle);
          lands.set(entry.id, land);

          closers.push(() => {
            // Сначала дописать, потом отписаться: сохранение идёт в микрозадаче,
            // и закрытие без `save()` теряет правки последнего кадра.
            vault.save();
            vault.close();
          });
          if (withTabs) {
            const tabs = syncTabs({ land, id: at, ...(report && { report }) });
            closers.push(() => {
              tabs.close();
            });
          }
          hydrating.push(vault.opened());
        }

        await Promise.all(hydrating);

        // Посев — только после гидрации: до неё ленд пуст не потому, что новый,
        // а потому, что данные ещё едут, и «пусто — сею» посеяло бы поверх.
        for (const entry of entries) {
          const handle = byModule.get(entry.id);
          if (handle !== undefined) entry.seed?.(handle.space);
        }

        opened.value = true;
      }
      catch (error) {
        // Полуоткрытая сборка хуже закрытой: экран показал бы часть модулей и
        // посеял бы поверх непрочитанного.
        unwind();
        throw error;
      }
    },

    async wipe(ids: readonly string[]): Promise<void> {
      if (opened.value) throw new Error('lands can be erased only under lock: seal() first');
      for (const id of ids) await inner.drop(landId(id));
    },

    async seal(): Promise<void> {
      if (!opened.value) return;
      unwind();
      // Дождаться, пока дописанное действительно уедет в носитель: ключ
      // забывают сразу после этого вызова, а запечатать пачку без ключа нельзя.
      const pending = settling;
      settling = new Set();
      await Promise.allSettled(pending);
    },

    async close(): Promise<void> {
      unwind();
      await Promise.allSettled(settling);
    },
  };
}

function handleOf(
  byModule: ReadonlyMap<string, LandHandle>,
  moduleId: string,
  opened: boolean,
): LandHandle {
  const found = byModule.get(moduleId);
  if (found === undefined) {
    if (!opened) {
      throw new Error(`land «${moduleId}» is still locked: module spaces appear after the lock is removed`);
    }
    throw new Error(`module «${moduleId}» is not assembled: it has no space`);
  }
  return found;
}
