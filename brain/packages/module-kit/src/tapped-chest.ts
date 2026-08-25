import type { LandId } from '@sync/core';
import type { Sealed } from '@brain/auth';
import type { Chest } from './sealed';

/**
 * Кран сундука: «в журнал ленда лёг такой-то кусок».
 *
 * Декоратор, а не правка `sealedStore`, и это граница по существу. Хранилище
 * отвечает на вопрос «как ленд лежит на диске»; синхронизация — на вопрос «что
 * из этого уехало на сервер». Смешать их значило бы протащить URL сервера и
 * счётчики отправленного в код, который сегодня прекрасно работает без сети
 * вовсе.
 *
 * Точка выбрана та же, что у `Chest`, не выше: кран отдаёт ГОТОВЫЙ шифртекст,
 * ровно тот, что лёг на диск. Слушателю (`apps/web/src/sync`) не нужен ни ключ,
 * ни открытая пачка — он их и не увидит.
 *
 * Компакция сообщается отдельным событием, потому что она меняет НУМЕРАЦИЮ: то,
 * что было куском №5, после неё не существует, а весь журнал стал куском №0.
 * Слушатель, знающий только про «дописано», разослал бы серверу мусор.
 */
export interface ChestTap {
  /** В хвост журнала лёг кусок. `at` — его номер, считая с нуля. */
  readonly onAppend?: (land: LandId, chunk: Sealed, at: number) => void;
  /** Журнал заменён одним куском: всё, что было, больше не существует. */
  readonly onReplace?: (land: LandId, chunk: Sealed) => void;
  /** Ленд забыт целиком. */
  readonly onWipe?: (land: LandId) => void;
}

/**
 * Обернуть сундук краном.
 *
 * Слушатель зовётся ПОСЛЕ успеха носителя: сообщать про кусок, который не лёг
 * на диск, значило бы отправить на сервер то, чего у нас самих нет, — и потерять
 * это при следующем подъёме.
 *
 * Отказ слушателя не имеет права уронить сохранение: синхронизация — надстройка,
 * и приложение обязано остаться полностью работоспособным без неё.
 */
export function tappedChest(inner: Chest, tap: ChestTap): Chest {
  /**
   * Сколько кусков в журнале каждого ленда. Заводится первым `read` — тем
   * самым, которым `sealedStore` поднимает ленд, — и дальше идёт по своим
   * записям: другого писателя у сундука в этой вкладке нет.
   */
  const counts = new Map<string, number>();

  const bump = (land: LandId): number => {
    const at = counts.get(land.str) ?? 0;
    counts.set(land.str, at + 1);
    return at;
  };

  return {
    async read(land) {
      const chunks = await inner.read(land);
      counts.set(land.str, chunks.length);
      return chunks;
    },

    async append(land, chunk) {
      await inner.append(land, chunk);
      safely(() => tap.onAppend?.(land, chunk, bump(land)));
    },

    async replace(land, chunk) {
      await inner.replace(land, chunk);
      counts.set(land.str, 1);
      safely(() => tap.onReplace?.(land, chunk));
    },

    async wipe(land) {
      await inner.wipe(land);
      counts.delete(land.str);
      safely(() => tap.onWipe?.(land));
    },

    lands: () => inner.lands(),
    close: () => inner.close(),
  };
}

function safely(work: () => void): void {
  try {
    work();
  }
  catch (error) {
    // Синхронизация — надстройка над хранилищем: её отказ не имеет права
    // выглядеть как «диск не принял пачку». Тот бы вернулся к вызывающему и
    // заставил `sealedStore` забыть образ ленда.
    console.error('[brain] кран сундука:', error);
  }
}
