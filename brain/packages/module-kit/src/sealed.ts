import { Link, memoryStore } from '@sync/core';
import type { LandId, MemoryStore, UnitStore } from '@sync/core';
import type { OpenVault, Sealed } from '@brain/auth';

/**
 * Хранилище, которое кладёт на диск ШИФРТЕКСТ (docs/01-security.md §4).
 *
 * ─── Где проходит граница ───────────────────────────────────────────────────
 *
 * Ровно по `UnitStore`: `save` запечатывает пачку, `load` распечатывает. Выше
 * границы движок работает с открытыми байтами и про шифрование не знает вовсе —
 * поэтому синхронное чтение (`doc.title()` без `await`) продолжает работать:
 * ленд после `load` целиком лежит расшифрованным в памяти, как и раньше.
 *
 * ─── Почему не «один запечатанный образ на ленд» ────────────────────────────
 *
 * Соблазн: держать по одной записи на ленд и переписывать её на каждом
 * сохранении. Так нельзя, и причина арифметическая. AES-GCM запечатывает пачку
 * ЦЕЛИКОМ, то есть правка одного байта заставляет перешифровать и переписать
 * весь ленд. Тело заметки хранится строкой, сохранение идёт по расписанию
 * редактора — на ленде в мегабайт это мегабайт записи на каждое нажатие с
 * задержкой. Ровно от такого усиления записи уходит `idbStore`, храня страницы
 * («батч пачкает 16 страниц по 4 КиБ, а не переписывает 5.6 МБ»), и терять это
 * ради шифрования незачем.
 *
 * Поэтому здесь ЖУРНАЛ запечатанных дельт: `save` дописывает один кусок
 * размером с дельту. Склейка закодированных пачек побайтово сама является
 * валидной пачкой (формат: за секцией ленда идёт следующий заголовок), поэтому
 * `load` — это «расшифровать куски по порядку и склеить».
 *
 * ─── Что держит журнал от бесконечного роста ────────────────────────────────
 *
 * Компакция по бюджету: как только накопленный шифртекст догоняет полезный
 * объём ленда, лог перепечатывается ОДНИМ куском. Отсюда два числа, которые и
 * есть цена решения: на носителе ленд занимает не больше 2× полезного объёма, а
 * усиление записи в среднем не больше 2× — те же гарантии, что у любого
 * лог-структурированного хранилища.
 *
 * ─── Зачем здесь образ в памяти ─────────────────────────────────────────────
 *
 * `memoryStore` держит слитый образ каждого ленда — тот же `PackImage`, что
 * лежит внутри `idbStore`, только без носителя. Он нужен по существу: без него
 * компакция не имеет что перепечатать, а `load` отдавал бы склейку со всеми
 * перекрытыми версиями юнитов. Памяти это не добавляет: `idbStore` тоже держит
 * образ ленда целиком («юниты лежат по офсетам, разбор идёт по всему образу»).
 */

/** Байты, которыми начинается ЛЮБАЯ открытая пачка `@sync/core`: метка секции. */
const PACK_MAGIC = [0x4C, 0x41, 0x4E, 0x44] as const;

/**
 * Носитель запечатанных кусков.
 *
 * Отделён от {@link sealedStore} по той же оси, что `Volume` от `UnitStore` в
 * ядре: здесь живёт «как байты доезжают до носителя», там — «что такое ленд».
 * Благодаря этому весь журнал с компакцией пишется один раз, а тесты идут на
 * памяти, где IndexedDB нет вовсе.
 */
export interface Chest {
  /** Куски ленда в порядке записи. Незнакомый ленд — пустой список, не отказ. */
  read(land: LandId): Promise<readonly Sealed[]>;
  /** Дописать кусок в хвост. */
  append(land: LandId, chunk: Sealed): Promise<void>;
  /** Заменить весь журнал одним куском. Атомарно: иначе компакция теряла бы ленд. */
  replace(land: LandId, chunk: Sealed): Promise<void>;
  /** Забыть ленд целиком. Незнакомый ленд — не ошибка. */
  wipe(land: LandId): Promise<void>;
  /** Какие ленды лежат запечатанными. */
  lands(): Promise<readonly LandId[]>;
  close(): Promise<void>;
}

export interface SealedStoreOptions {
  /** Открытое хранилище ключа. Без него шифровать нечем — тип не даёт забыть. */
  readonly vault: OpenVault;
  readonly chest: Chest;
}

export interface SealedStore extends UnitStore {
  load(land: LandId): Promise<Uint8Array>;
  save(land: LandId, pack: Uint8Array): Promise<void>;
  ball(land: LandId, shot: Uint8Array): Promise<Uint8Array | undefined>;
  drop(land: LandId): Promise<void>;
  lands(): Promise<readonly LandId[]>;
  /**
   * Дождаться, пока принятые пачки доедут до сундука.
   *
   * Ручка сверх контракта, и нужна она ровно замку: ключ забывают синхронно, а
   * последняя пачка в этот момент ещё запечатывается. Без ожидания правки
   * последнего кадра упирались бы в «хранилище заперто».
   */
  settled(): Promise<void>;
}

/**
 * Насколько журналу позволено превысить полезный объём ленда, прежде чем его
 * перепечатают одним куском.
 *
 * Двойка, а не единица, и это существенно. Сразу после компакции журнал ВЕСИТ
 * примерно столько же, сколько образ, — сравнение «журнал догнал образ» было бы
 * истинным немедленно, и следующее сохранение перепечатывало бы ленд целиком.
 * То есть порог в единицу означает не «журнал с компакцией», а «полная
 * перезапись на каждое сохранение» — ровно то, от чего журнал заводился.
 * Поймано живой проверкой: ленд инбокса перепечатывался на каждой записи.
 *
 * С двойкой после компакции остаётся запас размером с образ, и цена выходит та,
 * что записана в docs/01-security.md §4.1: на носителе не больше 2× полезного
 * объёма, усиление записи в среднем не больше 2×.
 */
const LOG_GROWTH = 2;

/**
 * Сколько кусков журнал вправе накопить.
 *
 * Отдельно от объёма, потому что цена у них разная: объём платится при записи, а
 * ЧИСЛО кусков — при подъёме, где каждый кусок это отдельная расшифровка и
 * отдельная строка базы. Растущий ленд может держаться в бюджете по байтам
 * вечно (дельты не перекрывают друг друга, компактить нечего), и без этого
 * потолка сеанс из десяти тысяч правок оставил бы десять тысяч кусков
 * следующему запуску.
 */
const LOG_CHUNKS = 64;

/** Состояние одного ленда: поднят ли образ и что лежит в журнале. */
interface Slot {
  hydrated: boolean;
  /** Байт шифртекста в журнале. */
  logged: number;
  /** Кусков в журнале. */
  chunks: number;
  /** Операции ленда идут строго по одной: у журнала есть порядок. */
  gate: Promise<unknown>;
}

export function sealedStore(options: SealedStoreOptions): SealedStore {
  const { vault, chest } = options;
  // Одно зеркало: атомарность даёт сундук (одна транзакция на кусок), а второе
  // зеркало здесь удвоило бы память, ничего не защищая.
  const mem: MemoryStore = memoryStore({ mirrors: 1 });
  const slots = new Map<string, Slot>();

  const slotOf = (land: LandId): Slot => {
    let found = slots.get(land.str);
    if (found === undefined) {
      found = { hydrated: false, logged: 0, chunks: 0, gate: Promise.resolve() };
      slots.set(land.str, found);
    }
    return found;
  };

  /** Поднять образ ленда: расшифровать журнал и слить куски в один образ. */
  const hydrate = async (land: LandId, slot: Slot): Promise<void> => {
    if (slot.hydrated) return;
    let logged = 0;
    let chunks = 0;
    for (const chunk of await chest.read(land)) {
      mem.save(land, await vault.openPack(land.str, chunk));
      logged += chunk.cipher.length;
      chunks += 1;
    }
    slot.logged = logged;
    slot.chunks = chunks;
    slot.hydrated = true;
  };

  /**
   * Операции одного ленда по очереди.
   *
   * Не «для порядка вызовов» (его обещает контракт и без очереди), а потому что
   * журнал упорядочен: два `save` внахлёст дописали бы куски в порядке ответа
   * сундука, и более старая версия юнита легла бы поверх новой.
   *
   * Отказ забывает образ ленда: он ушёл вперёд носителя, и это самый опасный из
   * исходов — следующее сохранение дописало бы кусок поверх состояния, которого
   * на диске нет. Непринятую пачку `openVault` держит у себя и подаст снова.
   */
  const serial = <T>(land: LandId, task: (slot: Slot) => Promise<T>): Promise<T> => {
    const slot = slotOf(land);
    const next = slot.gate.then(() => task(slot), () => task(slot)).catch((error: unknown) => {
      slot.hydrated = false;
      slot.logged = 0;
      slot.chunks = 0;
      mem.drop(land);
      throw error;
    });
    slot.gate = next.then(nothing, nothing);
    return next;
  };

  return {
    load: land => serial(land, async (slot) => {
      await hydrate(land, slot);
      return mem.load(land);
    }),

    save: (land, pack) => serial(land, async (slot) => {
      await hydrate(land, slot);
      // Образ правится ДО записи: он источник для компакции, и класть в него
      // пачку после успеха значило бы компактить состояние без неё.
      mem.save(land, pack);

      const chunk = await vault.sealPack(land.str, pack);
      // Шифртекст сравнивается с ОТКРЫТЫМ объёмом: GCM добавляет к куску нонс и
      // метку — 28 байт, — и на этом бюджете это шум.
      const fits = slot.logged + chunk.cipher.length < LOG_GROWTH * mem.live(land);
      if (fits && slot.chunks < LOG_CHUNKS) {
        await chest.append(land, chunk);
        slot.logged += chunk.cipher.length;
        slot.chunks += 1;
        return;
      }

      const whole = await vault.sealPack(land.str, mem.load(land));
      await chest.replace(land, whole);
      slot.logged = whole.cipher.length;
      slot.chunks = 1;
    }),

    /**
     * Выносное значение по его `shot`.
     *
     * Контракт ядра обещает отдать значение, НЕ ПОДНИМАЯ ленд, и поверх
     * шифртекста целой пачки это обещание сохраняется лишь наполовину: ленд
     * действительно не разбирается на юниты, но образ приходится расшифровать
     * целиком — ключ запечатывает пачку, а не отдельное значение.
     *
     * Метод оставлен рабочим, а не бросающим, ровно потому, что молча сломанный
     * метод хуже честно дорогого: в brain его сегодня не зовёт никто (ни
     * оболочка, ни модули, ни сам движок — `openVault` за баллами не ходит), и
     * первый же вызывающий получит правильное значение, а не отказ.
     */
    ball: (land, shot) => serial(land, async (slot) => {
      await hydrate(land, slot);
      return mem.ball(land, shot);
    }),

    drop: land => serial(land, async (slot) => {
      await chest.wipe(land);
      mem.drop(land);
      slot.hydrated = true;
      slot.logged = 0;
      slot.chunks = 0;
    }),

    // Мимо очереди: `lands()` спрашивает сундук, а не образ ленда.
    lands: () => chest.lands(),

    async settled(): Promise<void> {
      // Снимок очередей, а не цикл до опустошения: зовут это после того, как
      // ленды закрыты, — новую работу подать уже некому, а `openVault` свою
      // последнюю пачку кладёт в очередь синхронно, на закрытии.
      await Promise.all([...slots.values()].map(slot => slot.gate));
    },
  };
}

// ── Сундук в памяти ──────────────────────────────────────────────────────────

/** Сундук в памяти — для тестов и для сборки без IndexedDB. */
export function memoryChest(): Chest {
  const logs = new Map<string, { id: LandId; chunks: Sealed[] }>();

  const logOf = (land: LandId): { id: LandId; chunks: Sealed[] } => {
    let found = logs.get(land.str);
    if (found === undefined) {
      found = { id: land, chunks: [] };
      logs.set(land.str, found);
    }
    return found;
  };

  return {
    read: land => Promise.resolve(logs.get(land.str)?.chunks ?? []),
    append: (land, chunk) => {
      logOf(land).chunks.push(chunk);
      return Promise.resolve();
    },
    replace: (land, chunk) => {
      logOf(land).chunks = [chunk];
      return Promise.resolve();
    },
    wipe: (land) => {
      logs.delete(land.str);
      return Promise.resolve();
    },
    lands: () => Promise.resolve([...logs.values()].map(log => log.id)),
    close: () => Promise.resolve(),
  };
}

// ── Сундук на IndexedDB ──────────────────────────────────────────────────────

const DB_VERSION = 1;
const CHUNKS = 'chunks';
const LANDS = 'lands';

/** Пустой массив ключей сортируется после любого другого — это «всё, что начинается с». */
const ABOVE: readonly unknown[] = [];

export interface IdbChestOptions {
  /** Имя базы. По умолчанию — `brain-sealed`. */
  readonly name?: string;
  readonly factory?: IDBFactory;
  readonly ranges?: typeof IDBKeyRange;
}

/**
 * Сундук на IndexedDB: `[ленд, номер] → {нонс, шифртекст}`.
 *
 * База ОТДЕЛЬНАЯ от той, в которой лежит открытый мета-ленд, и это не вкусовое
 * решение. Во-первых, `idbStore` открывает свою базу версией 1 и сломался бы от
 * чужой миграции схемы в ней же. Во-вторых, отсюда берётся надёжное опознание
 * при переезде: открытый ленд — тот, что лежит в базе `idbStore`, запечатанный —
 * тот, что здесь. Про содержимое при этом ничего гадать не нужно.
 */
export function idbChest(options: IdbChestOptions = {}): Chest {
  const name = options.name ?? 'brain-sealed';
  const factory = options.factory ?? globalThis.indexedDB;
  const ranges = options.ranges ?? globalThis.IDBKeyRange;
  if (factory === undefined || ranges === undefined) {
    throw new Error('IndexedDB не найден: сундук нужно подать явно — idbChest({ factory, ranges })');
  }

  let db: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;
  /** Следующий номер куска. Заводится чтением и живёт до конца сеанса. */
  const next = new Map<string, number>();

  const database = (): Promise<IDBDatabase> => {
    if (db !== null) return Promise.resolve(db);
    if (opening !== null) return opening;

    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = (): void => {
      const fresh = request.result;
      if (!fresh.objectStoreNames.contains(CHUNKS)) fresh.createObjectStore(CHUNKS);
      if (!fresh.objectStoreNames.contains(LANDS)) fresh.createObjectStore(LANDS);
    };
    opening = ask(request).then((fresh) => {
      db = fresh;
      opening = null;
      return fresh;
    });
    return opening;
  };

  const span = (land: LandId): IDBKeyRange => ranges.bound([land.str], [land.str, ABOVE]);

  /** Номер следующего куска. Спрашивается у базы, если сеанс его ещё не знает. */
  const seqOf = async (land: LandId): Promise<number> => {
    const known = next.get(land.str);
    if (known !== undefined) return known;

    const tx = (await database()).transaction(CHUNKS, 'readonly');
    const keys = await ask(tx.objectStore(CHUNKS).getAllKeys(span(land)));
    let top = -1;
    for (const key of keys) {
      const seq = (key as [string, number])[1];
      if (seq > top) top = seq;
    }
    next.set(land.str, top + 1);
    return top + 1;
  };

  /** Положить кусок, зарегистрировав ленд той же транзакцией. */
  const put = async (land: LandId, chunk: Sealed, seq: number, wipeFirst: boolean): Promise<void> => {
    const tx = (await database()).transaction([CHUNKS, LANDS], 'readwrite');
    const chunks = tx.objectStore(CHUNKS);
    // Очистка и запись — ОДНОЙ транзакцией: иначе обрыв между ними оставил бы
    // ленд без единого куска, то есть потерянным целиком.
    if (wipeFirst) chunks.delete(span(land));
    chunks.put({ nonce: chunk.nonce, cipher: chunk.cipher }, [land.str, seq]);
    // Имя ленда идёт той же транзакцией, что и первый кусок: иначе куски
    // остались бы без имени, а `lands()` — без ленда.
    tx.objectStore(LANDS).put(land.bin.slice(), land.str);
    await ended(tx);
    next.set(land.str, seq + 1);
  };

  return {
    async read(land) {
      const tx = (await database()).transaction(CHUNKS, 'readonly');
      const store = tx.objectStore(CHUNKS);
      // Оба запроса выпускаются ДО первого `await`: транзакция активна лишь до
      // возврата управления циклу событий.
      const keys = ask(store.getAllKeys(span(land)));
      const values = ask(store.getAll(span(land)));
      const [found, rows] = await Promise.all([keys, values]);

      let top = -1;
      for (const key of found) {
        const seq = (key as [string, number])[1];
        if (seq > top) top = seq;
      }
      next.set(land.str, top + 1);
      // Порядок гарантирует сама база: ключи `[ленд, номер]` перечисляются по
      // возрастанию, а номер растёт с каждым куском.
      return rows as Sealed[];
    },

    async append(land, chunk) {
      await put(land, chunk, await seqOf(land), false);
    },

    async replace(land, chunk) {
      await put(land, chunk, 0, true);
    },

    async wipe(land) {
      const tx = (await database()).transaction([CHUNKS, LANDS], 'readwrite');
      tx.objectStore(CHUNKS).delete(span(land));
      tx.objectStore(LANDS).delete(land.str);
      await ended(tx);
      next.delete(land.str);
    },

    async lands() {
      const tx = (await database()).transaction(LANDS, 'readonly');
      const rows = await ask(tx.objectStore(LANDS).getAll());
      return rows.map(row => Link.from(row as Uint8Array));
    },

    close() {
      db?.close();
      db = null;
      opening = null;
      next.clear();
      return Promise.resolve();
    },
  };
}

function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((done, fail) => {
    request.onsuccess = (): void => done(request.result);
    request.onerror = (): void => fail(request.error ?? new Error('запрос IndexedDB отклонён'));
  });
}

function ended(tx: IDBTransaction): Promise<void> {
  return new Promise((done, fail) => {
    tx.oncomplete = (): void => done();
    tx.onerror = (): void => fail(tx.error ?? new Error('транзакция IndexedDB отклонена'));
    tx.onabort = (): void => fail(tx.error ?? new Error('транзакция IndexedDB отменена'));
  });
}

// ── Переезд ──────────────────────────────────────────────────────────────────

export interface SealExistingOptions {
  /** Открытое хранилище — то, в котором ленды лежали текстом. */
  readonly plain: UnitStore;
  readonly chest: Chest;
  readonly vault: OpenVault;
  /** Ленды, которые остаются открытыми: мета-ленд с обёртками ключа. */
  readonly keep?: readonly LandId[];
}

/**
 * Один раз переписать открытые ленды запечатанными.
 *
 * ОПОЗНАНИЕ ПО МЕСТУ, а не по содержимому: открытый ленд — тот, который знает
 * `idbStore`, запечатанный — тот, который знает сундук. Базы разные, пересечься
 * им негде, и «на что похожи эти байты» гадать не приходится вовсе. Метка
 * секции проверяется сверх того — как утверждение о том, что мы читаем именно
 * пачку, а не чужие байты, попавшие в базу.
 *
 * Идемпотентно: сначала запечатываем, потом забываем открытую копию. Обрыв
 * между шагами оставляет ленд в обоих местах, и следующий запуск перепечатает
 * его теми же байтами. Обратный порядок терял бы ленд целиком.
 *
 * Отказ НЕ проглатывается: ленд, который не переехал, обязан остановить запуск,
 * иначе приложение откроется без части данных и напишет поверх них новые.
 */
export async function sealExisting(options: SealExistingOptions): Promise<readonly LandId[]> {
  const { plain, chest, vault } = options;
  const keep = new Set((options.keep ?? []).map(land => land.str));
  const moved: LandId[] = [];

  for (const land of await plain.lands()) {
    if (keep.has(land.str)) continue;

    const bin = await plain.load(land);
    if (!isOpenPack(bin)) {
      throw new Error(
        `ленд «${land.str}» в открытой базе не выглядит пачкой: переезд остановлен, `
        + 'чтобы не запечатать мусор вместо данных',
      );
    }

    await chest.replace(land, await vault.sealPack(land.str, bin));
    await plain.drop(land);
    moved.push(land);
  }

  return moved;
}

/** Метка секции `"LAND"` в начале — признак того, что это открытая пачка. */
export function isOpenPack(bin: Uint8Array): boolean {
  if (bin.length < PACK_MAGIC.length) return false;
  for (let i = 0; i < PACK_MAGIC.length; i++) {
    if (bin[i] !== PACK_MAGIC[i]) return false;
  }
  return true;
}

// ── Перевыпуск под новым ключом ────────────────────────────────────────────

export interface ResealOptions {
  readonly chest: Chest;
  /** Ключ, которым запечатано то, что СЕЙЧАС лежит в сундуке. */
  readonly from: OpenVault;
  /** Ключ, под которым журнал ляжет заново. */
  readonly to: OpenVault;
  /** Какие ленды перепечатать. Мета-ленда здесь не бывает — он не запечатан вовсе. */
  readonly lands: readonly LandId[];
}

/**
 * Перепечатать журналы лендов под ДРУГИМ ключом — целиком, одним куском на
 * ленд (docs/01-security.md §7: присоединение с уже имеющимися локальными
 * данными и отзыв способа доступа — оба случая меняют DEK у уже живых данных).
 *
 * ПОЧЕМУ НЕ через `sealedStore.save()` напрямую: `save` перед записью ВСЕГДА
 * поднимает существующий образ СВОИМ ключом (`hydrate`) — а здесь ключ для
 * подъёма (`from`) и ключ для печати (`to`) РАЗНЫЕ. Стор, заведённый на `to`,
 * попытался бы расшифровать лежащий в сундуке шифртекст `from`-ключом и бросил
 * бы на первом же куске. Поэтому подъём и печать проведены раздельно и явно:
 * `from` поднимает через ОДИН временный `sealedStore` (его машинерия компакции
 * уже умеет склеить журнал дельт в цельный образ — не переписывать её здесь),
 * а `to` печатает НАПРЯМУЮ в `chest.replace`, без промежуточного стора,
 * которому нечего было бы удерживать между вызовами.
 *
 * Каждый ленд — ОТДЕЛЬНЫЙ `chest.replace`, не одна транзакция на всех: сундук
 * такой транзакции не даёт (`Chest` — по одному ленду за раз, как и everywhere
 * в этом файле), а частичный перевыпуск при обрыве не хуже, чем у любой другой
 * операции здесь, — он просто НЕ атомарен для НАБОРА лендов, и вызывающий
 * (`apps/web/src/security`) обязан быть готов повторить операцию по каждому
 * ленду, который остался под старым ключом.
 *
 * Синк (если он есть) обязан быть ОСТАНОВЛЕН до вызова: принятый кусок,
 * влитый в ленд, который сейчас перевыпускают, лёг бы туда старым ключом уже
 * после перепечатки и обесценил бы её.
 */
export async function reseal(options: ResealOptions): Promise<void> {
  const { chest, from, to, lands } = options;
  const reader = sealedStore({ vault: from, chest });
  for (const land of lands) {
    const pack = await reader.load(land);
    const chunk = await to.sealPack(land.str, pack);
    await chest.replace(land, chunk);
  }
}

function nothing(): void {
  // Очередь не отравляется отказом одной операции: следующая начинается заново,
  // а отказ уходит своему вызывающему.
}
