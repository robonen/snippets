import { chunkFromWire, chunkToWire, decodeFrame, encodeFrame } from '@brain/sync-wire';
import type { Chest, ChestTap } from '@brain/module-kit';
import type { LandId } from '@sync/core';
import type { OpenVault, Sealed } from '@brain/auth';
import type { Marks } from './marks';

/**
 * Синхронизация с сервером: местный журнал шифртекста ⇄ журнал сервера.
 *
 * ─── Что возит движок ────────────────────────────────────────────────────────
 *
 * Ровно те куски, что лежат в сундуке (`module-kit/sealed.ts`), — запечатанные
 * пачки `nonce || cipher`. Сервер к ним слеп (docs/01-security.md, У2), слияние
 * целиком на этой стороне: кусок расшифровывается вольтом и вливается в живой
 * ленд ТЕМ ЖЕ путём, что и пачка из соседней вкладки, — `land.apply`.
 *
 * ─── Инварианты счётчиков ────────────────────────────────────────────────────
 *
 * `seen(land)` — длина ПРЕФИКСА кусков сервера, которые уже влиты. Растёт
 * только по факту успешного вливания и только подряд: кусок, который не
 * расшифровался (чужой DEK до обмена обёртками, Э2), оставляет счётчик на
 * месте — его перечитают на следующем коннекте, а куски за ним всё равно
 * вливаются. Соврать здесь значило бы молча потерять данные.
 *
 * `uploaded(land)` — сколько кусков МЕСТНОГО журнала отправлено. Компакция
 * сундука обнуляет его немедленно, а не по разнице длин: журнал после неё
 * начинается заново, и «дослать с пятого» отправило бы дельты без куска,
 * который несёт весь ленд.
 *
 * На коннекте: `HELLO(seen)` → сервер досылает хвост → `HEAD` → досылаем свои
 * `[uploaded..)`. Досылка ждёт `HEAD` намеренно: пока голова сервера
 * неизвестна, нельзя выбрать между компакцией и обычной дописью.
 *
 * ─── Компакция ───────────────────────────────────────────────────────────────
 *
 * Местный журнал сжался до одного куска — сервер может сжаться тоже, но только
 * если мы видели его целиком: `REPLACE` уходит при `seen == head`, иначе кусок
 * идёт обычным `APPEND`. Отказ `REJECT` — то же самое: догоняем и дописываем.
 * Сервер при этом подрастает, но состояние сходится — применение идемпотентно.
 *
 * ─── Эхо ─────────────────────────────────────────────────────────────────────
 *
 * Кусок, влитый с сервера, попадает в местный журнал (писатель сохраняет
 * услышанное) и может уйти обратно `APPEND`-ом один раз. Это не дефект и не
 * лечится фильтром происхождения: повторное применение идемпотентно, `apply`
 * возвращает ноль принятых юнитов, новых кусков не рождается — на втором круге
 * петля гаснет сама.
 */

/** Провод: один сокет на все ленды. Реализация — `socket.ts`, в тестах — фейк. */
export interface Wire {
  /** Отправить кадр. `false` — связи нет; догоним на следующем коннекте. */
  send(frame: Uint8Array): boolean;
  close(): void;
}

export interface WireHandlers {
  /** Связь появилась. Зовётся на КАЖДОМ коннекте, включая реконнекты. */
  open(): void;
  frame(bytes: Uint8Array): void;
}

export interface SyncEngineOptions {
  /** Ленды, которые синхронизируются. Мета-ленда здесь нет (см. `index.ts`). */
  readonly lands: readonly LandId[];
  readonly chest: Chest;
  readonly vault: OpenVault;
  readonly marks: Marks;
  /** Влить открытую пачку в живой ленд — тем же путём, что канал вкладок. */
  readonly merge: (land: LandId, pack: Uint8Array) => void;
  readonly wire: (handlers: WireHandlers) => Wire;
  readonly report?: (error: unknown) => void;
}

export interface SyncEngine {
  /** Кран сундука: подаётся в `tappedChest`. */
  readonly tap: ChestTap;
  close(): void;
}

/** Состояние одного ленда в этом соединении. */
interface LandState {
  readonly id: LandId;
  /** Последняя названная сервером голова. `-1` — ещё не знаем. */
  head: number;
  /** Влитые куски ВЫШЕ дыры: ждут, пока дыра закроется, чтобы поднять `seen`. */
  readonly ahead: Set<number>;
  /** Догрузка своего хвоста уже сделана в этом соединении. */
  pushed: boolean;
  /** Кусок, ждущий ответа на `REPLACE`: при отказе уйдёт `APPEND`-ом. */
  pending: Uint8Array | null;
  /** Кадры ленда обрабатываются строго по одному: у журнала есть порядок. */
  gate: Promise<unknown>;
}

export function syncEngine(options: SyncEngineOptions): SyncEngine {
  const { chest, vault, marks, merge } = options;
  const report = options.report ?? ((error: unknown) => console.error('[brain] синк:', error));

  const states = new Map<string, LandState>();
  for (const id of options.lands) {
    states.set(id.str, { id, head: -1, ahead: new Set(), pushed: false, pending: null, gate: Promise.resolve() });
  }

  let closed = false;

  const wire = options.wire({
    open: () => {
      for (const state of states.values()) {
        state.head = -1;
        state.pushed = false;
        state.pending = null;
        state.ahead.clear();
        serial(state, async () => {
          const land = state.id.str;
          /*
           * Сверка с сундуком ДО привета — это и есть сценарий «кэш потерян,
           * ключи целы». Счётчики живут в localStorage, журнал — в IndexedDB,
           * и стереть их можно порознь: пустой журнал при ненулевых счётчиках
           * означает, что кэш шифртекста пропал. Привет с прежним `seen`
           * пропустил бы всё, что сервер уже отдавал, и ленд остался бы пустым
           * навсегда. Сброс же безопасен ВСЕГДА: повторное применение
           * идемпотентно — дорого бывает только перечитать, потерять нельзя.
           */
          if ((marks.seen(land) > 0 || marks.uploaded(land) > 0) && (await chest.read(state.id)).length === 0) {
            marks.forget(land);
          }
          // Привет на КАЖДОМ коннекте: он закрывает всё, что пропущено, пока
          // связи не было. Досылка своего ждёт ответной головы.
          send(encodeFrame({ op: 'hello', land, have: marks.seen(land) }));
        });
      }
    },
    frame: (bytes) => {
      const frame = decodeFrame(bytes);
      if (frame === null) return;
      const state = states.get(frame.land);
      // Кадр про ленд, которого мы не синхронизируем, — не наше дело: он мог
      // прийти от сервера, который знает больше лендов, чем открыто здесь.
      if (state === undefined) return;

      // `hello`, `append` и `replace` сюда не попадают: это кадры клиента, и от
      // сервера они мусор.
      if (frame.op === 'chunk') {
        serial(state, () => absorb(state, frame.index, frame.bytes));
      }
      else if (frame.op === 'head') {
        serial(state, async () => {
          state.head = frame.count;
          if (state.pending !== null) {
            // Ответ на нашу компакцию: журнал сервера теперь наш кусок, и
            // видели мы его целиком — иначе `REPLACE` не ушёл бы. Значит,
            // `seen` можно поднять, не перечитывая свой же кусок обратно.
            state.pending = null;
            marks.sawUpTo(state.id.str, frame.count);
            marks.sentUpTo(state.id.str, 1);
            return;
          }
          await push(state);
        });
      }
      else if (frame.op === 'reject') {
        serial(state, async () => {
          state.head = frame.head;
          const chunk = state.pending;
          state.pending = null;
          // Компакция не состоялась — сервер ушёл вперёд. Досылаем тот же
          // кусок обычной дописью: он несёт весь ленд, сервер подрастёт, но
          // сойдётся. Повторим компакцию, когда догоним.
          if (chunk !== null && send(encodeFrame({ op: 'append', land: state.id.str, bytes: chunk }))) {
            marks.sentUpTo(state.id.str, 1);
          }
          await Promise.resolve();
        });
      }
    },
  });

  function send(frame: Uint8Array): boolean {
    return !closed && wire.send(frame);
  }

  /** Кадры ленда — по одному: `seen` считается по порядку, а расшифровка асинхронна. */
  function serial(state: LandState, work: () => Promise<void>): void {
    state.gate = state.gate.then(work, work).catch(report);
  }

  /** Принять кусок сервера: расшифровать, влить, подвинуть `seen`. */
  async function absorb(state: LandState, index: number, bytes: Uint8Array): Promise<void> {
    const land = state.id.str;
    const sealed = chunkFromWire(bytes);
    if (sealed === null) return;

    let pack: Uint8Array;
    try {
      pack = await vault.openPack(land, sealed);
    }
    catch (error) {
      // Не расшифровался — данные не наши либо повреждены. `seen` НЕ двигаем:
      // пусть перечитается, когда появится нужная обёртка ключа (Э2).
      report(error);
      return;
    }

    merge(state.id, pack);

    // Счётчик растёт только сплошным префиксом: дыра оставляет его на месте, а
    // куски за дырой ждут в `ahead`.
    state.ahead.add(index);
    let seen = marks.seen(land);
    while (state.ahead.delete(seen)) seen += 1;
    marks.sawUpTo(land, seen);
  }

  /** Догрузка своего хвоста. Зовётся один раз на коннект, после первой головы. */
  async function push(state: LandState): Promise<void> {
    if (state.pushed) return;
    state.pushed = true;

    const land = state.id.str;
    const local = await chest.read(state.id);
    let from = marks.uploaded(land);
    if (from > local.length) {
      // Журнал короче отправленного: его перепечатали мимо нашего крана —
      // другой вкладкой. Заливаем заново, это дешевле, чем гадать.
      from = 0;
    }
    if (from >= local.length) return;

    /*
     * Догрузка НИКОГДА не компактит сервер, даже когда местный журнал — один
     * кусок и голова сервера догнана. Причина в гонке: куски, влитые минуту
     * назад, уходят на диск микрозадачей писателя, и прочитанный здесь журнал
     * может их ещё не содержать. `REPLACE` таким журналом снёс бы с сервера
     * данные, которые в этот момент живут только в памяти вкладки, — а падение
     * в этом окне унесло бы их насовсем.
     *
     * У живой компакции (`tap.onReplace`) этой гонки нет по построению: сундук
     * получает кусок, собранный из ОБРАЗА ленда, то есть со всем влитым. Ей
     * компакция сервера и оставлена; журнал, сжатый в офлайне, доедет обычной
     * дописью, а сожмётся на следующей.
     */
    for (let at = from; at < local.length; at++) {
      if (!send(encodeFrame({ op: 'append', land, bytes: chunkToWire(local[at] as Sealed) }))) return;
      marks.sentUpTo(land, at + 1);
    }
  }

  return {
    tap: {
      onAppend(id, chunk, at) {
        const state = states.get(id.str);
        if (state === undefined) return;
        serial(state, async () => {
          // Отправляем только СЛЕДУЮЩИЙ по счёту кусок: пропуск означал бы
          // дыру в журнале сервера, а догрузка с `uploaded` закроет её сама на
          // ближайшем коннекте.
          if (marks.uploaded(id.str) !== at) return;
          if (send(encodeFrame({ op: 'append', land: id.str, bytes: chunkToWire(chunk) }))) {
            marks.sentUpTo(id.str, at + 1);
          }
          await Promise.resolve();
        });
      },

      onReplace(id, chunk) {
        const state = states.get(id.str);
        if (state === undefined) return;
        serial(state, async () => {
          const land = id.str;
          // Журнал начался заново — отправленного больше не существует.
          marks.sentUpTo(land, 0);
          const only = chunkToWire(chunk);

          if (state.head >= 0 && marks.seen(land) === state.head) {
            state.pending = only;
            if (!send(encodeFrame({ op: 'replace', land, ifHead: state.head, bytes: only }))) {
              state.pending = null;
            }
            return;
          }
          if (send(encodeFrame({ op: 'append', land, bytes: only }))) {
            marks.sentUpTo(land, 1);
          }
          await Promise.resolve();
        });
      },

      onWipe(id) {
        marks.forget(id.str);
      },
    },

    close() {
      closed = true;
      wire.close();
    },
  };
}
