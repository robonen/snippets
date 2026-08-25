import { useStorage } from './storage';
import type { Storage } from 'unstorage';

/**
 * Журнал запечатанных кусков — всё серверное состояние ленда.
 *
 * Сервер kcal поднимал ленд и гонял `exchange()` по открытым байтам. Здесь так
 * нельзя по построению: ленды запечатаны на устройстве (docs/01-security.md
 * §2, У2), ключа у сервера нет и не должно быть. Поэтому сервер — ХРАНИТЕЛЬ
 * append-only журнала, слепой к содержимому: кусок для него — непрозрачные
 * байты `nonce(12) || cipher`. Слияние остаётся на клиентах: каждый кусок —
 * валидная пачка CRDT, применение идемпотентно, порядок неважен.
 *
 * ─── Раскладка на диске ──────────────────────────────────────────────────────
 *
 *   head:<land>            «<поколение>:<число кусков>» — ЕДИНСТВЕННАЯ истина
 *   chunk:<land>:<g>:<n>   кусок n поколения g
 *
 * Журнал определяется головой: живо только то поколение, которое она называет.
 * Отсюда атомарность компакции без переименований, которых у unstorage нет:
 *
 *   1. новый кусок пишется в СЛЕДУЮЩЕЕ поколение — старый журнал не тронут;
 *   2. голова переписывается одной маленькой записью — это точка фиксации;
 *   3. куски прежнего поколения убираются — обрыв здесь оставляет мусор,
 *      а не дыру.
 *
 * Обрыв до шага 2 — журнал прежний, клиент не получил ответа и повторит.
 * Обрыв после — журнал уже новый, осиротевшие куски выметает {@link sweep}
 * при первом касании ленда после старта. Терять журнал негде.
 *
 * ─── Почему не `useStorage()` из nitro ───────────────────────────────────────
 *
 * Маунты из nitro-конфига запекаются на сборке, а `DATA_DIR` обязан читаться
 * на РАНТАЙМЕ — systemd подаёт окружение запущенному процессу, пересборка под
 * смену каталога данных была бы дичью. Плюс тот же код журнала гоняется в
 * тестах на памяти, без nitro вовсе. Одноимённый `useStorage()`, который здесь
 * ИМПОРТИРУЕТСЯ (`./storage.ts`), — не тот: это наш собственный синглтон над
 * ручным fs-драйвером, читающим `DATA_DIR` так же на рантайме, только один на
 * весь процесс — журнал делит его с сессиями, credentials и обёртками
 * (docs/04-server.md §0).
 */

export interface Journal {
  /** Сколько кусков в журнале. Незнакомый ленд — ноль, не отказ. */
  head(land: string): Promise<number>;
  /** Куски `[from..head)` в порядке записи. */
  read(land: string, from: number): Promise<readonly Uint8Array[]>;
  /** Дописать кусок в хвост. Возвращает новую голову. */
  append(land: string, chunk: Uint8Array): Promise<number>;
  /**
   * Оптимистичная компакция: если в журнале ровно `ifHead` кусков — заменить
   * его одним. Иначе отказ с текущей головой: клиент дочитает и решит сам.
   */
  replace(land: string, ifHead: number, chunk: Uint8Array): Promise<{ ok: boolean; head: number }>;
  /**
   * Забыть ленд. Ручка обслуживания: в протоколе удаления НЕТ — сервер
   * append-only, и забыть журнал может только хозяин железа руками.
   */
  wipe(land: string): Promise<void>;
}

interface Mark {
  gen: number;
  count: number;
}

const FRESH: Mark = { gen: 0, count: 0 };

export function fileJournal(storage: Storage): Journal {
  /** Ленды, у которых после старта уже вымели чужие поколения. */
  const swept = new Set<string>();

  const markOf = async (land: string): Promise<Mark> => {
    const raw = await storage.getItem<string>(`head:${land}`);
    if (raw === null) return FRESH;
    const parts = String(raw).split(':');
    const gen = Number(parts[0]);
    const count = Number(parts[1]);
    if (parts.length !== 2 || !Number.isInteger(gen) || !Number.isInteger(count) || gen < 0 || count < 0) {
      // Битая голова — повреждение хранилища. Молча счесть журнал пустым
      // значило бы затереть его следующей записью.
      throw new Error(`голова ленда «${land}» не разбирается: «${String(raw)}»`);
    }
    return { gen, count };
  };

  /**
   * Вымести куски НЕ живого поколения — восстановление после обрыва компакции.
   * Один проход на ленд на процесс: дальше поколения меняются только через
   * {@link Journal.replace}, который убирает за собой сам.
   */
  const sweep = async (land: string, live: number): Promise<void> => {
    if (swept.has(land)) return;
    swept.add(land);
    for (const key of await storage.getKeys(`chunk:${land}`)) {
      const gen = Number(key.split(':')[2]);
      if (gen !== live) await storage.removeItem(key);
    }
  };

  const chunkAt = async (land: string, gen: number, n: number): Promise<Uint8Array> => {
    const bin = await storage.getItemRaw<Uint8Array | ArrayBuffer>(`chunk:${land}:${gen}:${n}`);
    if (bin === null || bin === undefined) {
      throw new Error(`в журнале ленда «${land}» дыра на месте куска ${n}`);
    }
    // Файловый драйвер отдаёт `Buffer`. Он и есть `Uint8Array`, но с другим
    // прототипом, и наружу так уходить не должен: журнал обещает простые байты,
    // а `Buffer` тянет за собой node-специфичное поведение (своя сериализация в
    // JSON, свой `toString`). Вид без копии — сами байты по нашему смещению
    // принадлежат нам, даже если буфер взят из общего пула.
    const view = bin instanceof Uint8Array
      ? new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength)
      : new Uint8Array(bin);
    return view;
  };

  return {
    async head(land) {
      const mark = await markOf(land);
      await sweep(land, mark.gen);
      return mark.count;
    },

    async read(land, from) {
      const mark = await markOf(land);
      await sweep(land, mark.gen);
      const out: Uint8Array[] = [];
      for (let n = Math.max(0, from); n < mark.count; n++) {
        out.push(await chunkAt(land, mark.gen, n));
      }
      return out;
    },

    async append(land, chunk) {
      const mark = await markOf(land);
      await sweep(land, mark.gen);
      // Сначала кусок, потом голова: обрыв между ними оставляет сироту под
      // номером `count`, которую следующая запись просто перепишет.
      await storage.setItemRaw(`chunk:${land}:${mark.gen}:${mark.count}`, chunk);
      await storage.setItem(`head:${land}`, `${mark.gen}:${mark.count + 1}`);
      return mark.count + 1;
    },

    async replace(land, ifHead, chunk) {
      const mark = await markOf(land);
      await sweep(land, mark.gen);
      if (mark.count !== ifHead) return { ok: false, head: mark.count };

      const next = mark.gen + 1;
      await storage.setItemRaw(`chunk:${land}:${next}:0`, chunk);
      // Точка фиксации: до этой записи журнал прежний, после — новый.
      await storage.setItem(`head:${land}`, `${next}:1`);
      // Уборка прежнего поколения. Обрыв здесь не страшен: голова уже
      // показывает на новое, а сироты выметет `sweep` следующего запуска.
      for (const key of await storage.getKeys(`chunk:${land}:${mark.gen}`)) {
        await storage.removeItem(key);
      }
      return { ok: true, head: 1 };
    },

    async wipe(land) {
      await storage.removeItem(`head:${land}`);
      for (const key of await storage.getKeys(`chunk:${land}`)) {
        await storage.removeItem(key);
      }
      swept.delete(land);
    },
  };
}

// ── Журнал инстанса ──────────────────────────────────────────────────────────

let shared: Journal | null = null;

/**
 * Журнал на общем хранилище инстанса (`utils/storage.ts`): `DATA_DIR` из
 * окружения, по умолчанию `./data`. Никакого Redis — сервер свой, инстанс один
 * (docs/04-server.md).
 */
export function useJournal(): Journal {
  shared ??= fileJournal(useStorage());
  return shared;
}

// ── Очередь на ленд ──────────────────────────────────────────────────────────

/**
 * Очередь на ленд ВНУТРИ инстанса: два одновременных запроса к одному ленду не
 * имеют права читать-и-писать вперемешку — «прочитал голову, дописал кусок,
 * переписал голову» второго стёрло бы кусок первого (классический lost update).
 *
 * Между инстансами защиты нет и не нужно: личное пространство живёт на ОДНОМ
 * своём сервере (docs/04-server.md), и это предусловие, а не надежда.
 */
const lanes = new Map<string, Promise<void>>();

export function withLand<R>(land: string, work: () => Promise<R>): Promise<R> {
  const tail = lanes.get(land) ?? Promise.resolve();
  const run = tail.then(work, work);
  // В карте живёт «успокоенный» хвост: сравнение с самим собой при подчистке
  // обязано быть тождеством, а `run.catch()` каждый раз рождал бы новый промис.
  const settled = run.then(() => undefined, () => undefined);
  lanes.set(land, settled);
  settled.then(() => {
    if (lanes.get(land) === settled) lanes.delete(land);
  });
  return run;
}
