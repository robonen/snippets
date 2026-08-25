/**
 * Счётчики синхронизации — на УСТРОЙСТВЕ, рядом с `brain.peer`.
 *
 * Почему не в ленде: счётчики описывают отношения ЭТОГО устройства с сервером
 * («сколько его кусков я влил», «сколько своих отправил»), и у второго
 * устройства они свои. Уехав в ленд, они бы синхронизировались между
 * устройствами и врали бы каждому.
 *
 * localStorage, а не память: без переживания перезагрузки первый же запуск
 * заново скачивал бы весь журнал сервера и заново заливал бы свой. Работать это
 * будет (применение идемпотентно), а стоить — весь ленд на каждом старте.
 */

const PREFIX = 'brain.sync';

export interface Marks {
  /** Сколько кусков сервера уже влито в живой ленд. */
  seen(land: string): number;
  sawUpTo(land: string, count: number): void;
  /** Сколько кусков МЕСТНОГО журнала отправлено на сервер. */
  uploaded(land: string): number;
  sentUpTo(land: string, count: number): void;
  /** Забыть оба счётчика: ленд стёрт или его журнал перепечатан. */
  forget(land: string): void;
}

export type MarkStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function deviceMarks(storage: MarkStorage): Marks {
  const read = (key: string): number => {
    const raw = storage.getItem(key);
    if (raw === null) return 0;
    const value = Number(raw);
    // Битое значение — как будто счётчика нет: он не данные, а подсказка, и
    // ноль просто заставит перечитать журнал заново.
    return Number.isInteger(value) && value >= 0 ? value : 0;
  };

  return {
    seen: land => read(`${PREFIX}.seen:${land}`),
    sawUpTo: (land, count) => storage.setItem(`${PREFIX}.seen:${land}`, String(count)),
    uploaded: land => read(`${PREFIX}.sent:${land}`),
    sentUpTo: (land, count) => storage.setItem(`${PREFIX}.sent:${land}`, String(count)),
    forget: (land) => {
      storage.removeItem(`${PREFIX}.seen:${land}`);
      storage.removeItem(`${PREFIX}.sent:${land}`);
    },
  };
}
