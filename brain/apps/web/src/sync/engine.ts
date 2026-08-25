import {
  diffOf,
  facesFromPack,
  helloPack,
  packDecode,
  packEncode,
  packPart,
} from '@sync/core';
import type { Land, LandId } from '@sync/core';

/**
 * Движок синка: face-обмен ядра поверх одного WebSocket.
 *
 * Прежней машины состояний — счётчиков `seen`/`uploaded`, очередей `ahead`,
 * `REPLACE`/`REJECT` — больше нет, и не потому, что она переехала, а потому,
 * что её работу делает сам протокол ядра:
 *
 *   коннект   → фейсы каждого ленда («вот моё состояние»);
 *   ответ     → дельта сервера + его фейсы; по ним считается встречная дельта;
 *   правка    → кран ленда (`land.tap`) отдаёт пачку СВОИХ юнитов — она уезжает
 *               запечатанной; принятые сервером юниты вещаются соседям.
 *
 * Любой обрыв, потеря и рестарт сервера закрываются следующим приветом:
 * доставка идемпотентна, дельта считается от фейсов, локальный журнал ядра и
 * есть «непереданное». Хранить прогресс синка отдельно нечего.
 *
 * Крипта — на границе провода, объектом {@link Secure} от сборки (`app/boot`):
 * исходящее шифруется и ПОДПИСЫВАЕТСЯ, входящее ПРОВЕРЯЕТСЯ и расшифровывается.
 * Подпись покрывает хэши запечатанных юнитов (encrypt-then-sign), поэтому
 * сервер, подменивший заголовок, ломает печать — движок такой юнит отбросит.
 * Движок самого крипто не знает: политику (ключи, ростер, корень доверия
 * `keys`) держит `Secure`.
 */

/** Крипто-политика провода. Всё, что движок знает о шифровании и подписи. */
export interface Secure {
  /** Запечатать и подписать пачку перед отправкой. */
  outgoing(pack: Uint8Array): Promise<Uint8Array>;
  /** Проверить подписи и расшифровать принятую пачку (неаутентичное отброшено). */
  incoming(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface WireHandlers {
  open(): void;
  frame(bytes: Uint8Array): void;
}

export interface Wire {
  /** `false` — соединения сейчас нет; пачка не буферизуется (см. шапку). */
  send(frame: Uint8Array): boolean;
  close(): void;
}

export interface SyncLand {
  readonly id: LandId;
  readonly land: Land;
}

export interface SyncEngineOptions {
  readonly lands: readonly SyncLand[];
  /** Крипто-политика провода: шифр + подпись. */
  readonly secure: Secure;
  readonly wire: (handlers: WireHandlers) => Wire;
  /** Куда сообщать об отказах разбора и крипты. По умолчанию — console.error. */
  readonly report?: (error: unknown) => void;
}

export interface SyncEngine {
  close(): void;
}

export function syncEngine(options: SyncEngineOptions): SyncEngine {
  const report = options.report ?? ((error: unknown): void => console.error('[brain] sync:', error));
  const byLand = new Map<string, SyncLand>();
  for (const entry of options.lands) byLand.set(entry.id.str, entry);

  let closed = false;
  /** Кадры обрабатываются строго по очереди: приём — асинхронный (крипта). */
  let chain: Promise<void> = Promise.resolve();

  const queue = (work: () => Promise<void>): void => {
    chain = chain.then(async () => {
      if (closed) return;
      try {
        await work();
      }
      catch (error) {
        report(error);
      }
    });
  };

  const wire = options.wire({
    open(): void {
      // Привет каждым лендом: фейсы считаются по открытой памяти, но совпадают
      // с фейсами запечатанной формы — заголовки у форм общие.
      queue(async () => {
        for (const { id, land } of byLand.values()) wire.send(helloPack(land, id));
      });
    },

    frame(bytes: Uint8Array): void {
      queue(async () => {
        const opened = await options.secure.incoming(bytes);

        for (const [id, part] of packDecode(opened)) {
          const entry = byLand.get(id.str);
          if (entry === undefined) continue;

          // Юниты — в живой ленд: тот же путь, что у пачки соседней вкладки.
          // Повторная доставка идемпотентна, эхо гаснет само.
          if (part.units.length > 0) entry.land.apply(part.units, part.balls);

          // Фейсы — встречная дельта: у нас может быть то, чего сервер не видел
          // (правки офлайна, чужая потеря данных — `Fail Summ` ядра).
          if (part.faces.length > 0) {
            const delta = diffOf(entry.land.part(), facesFromPack(part.faces));
            if (delta.units.length === 0) continue;
            const pack = packEncode([[id, packPart({ units: delta.units, balls: delta.balls })]]);
            wire.send(await options.secure.outgoing(pack));
          }
        }
      });
    },
  });

  // Кран: пачка СОБСТВЕННЫХ правок уезжает по мере записи. Если соединения нет
  // — пачка просто пропадает из крана, и это не потеря: непереданное досчитает
  // дельта следующего привета.
  const stops: Array<() => void> = [];
  for (const { id, land } of byLand.values()) {
    stops.push(land.tap(id, (pack) => {
      queue(async () => {
        wire.send(await options.secure.outgoing(pack));
      });
    }));
  }

  return {
    close(): void {
      closed = true;
      for (const stop of stops) stop();
      wire.close();
    },
  };
}
