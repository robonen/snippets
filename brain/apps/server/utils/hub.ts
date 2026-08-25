import {
  Land,

  Link,

  diffOf,
  facesFromPack,
  facesOf,
  facesToPack,
  packDecode,
  packEncode,
  packPart,
  peerKey,
} from '@sync/core';
import type { LandId, PackParts } from '@sync/core';
import type { Storage } from 'unstorage';

/**
 * Хаб лендов: сервер — обычный ПИР ядра, а не отдельный протокол.
 *
 * Ленды приезжают запечатанными на уровне юнита (`@sync/core` crypto): payload
 * шифртекст, заголовки открыты. Поэтому серверу для слияния, дельт и вещания не
 * нужен ключ — он гоняет тот же `Land.apply`/`diffOf`, что и браузер, и вся
 * прежняя машинерия слепого журнала (поколения, компакция, REPLACE/REJECT,
 * счётчики на клиенте) не существует: её работу делает face-обмен ядра.
 *
 * Сообщение = пачка формата ядра (ленд в заголовке секции). Семантика та же,
 * что у `wire/exchange.ts`: юниты применяются, на фейсы отвечаем дельтой и
 * своими фейсами, принятые юниты вещаются соседям по ленду.
 *
 * ─── Персист ленив, и это безопасно ──────────────────────────────────────────
 *
 * Образ ленда пишется одним куском с отложкой после последнего изменения.
 * Упавший между приёмом и записью процесс НЕ теряет данные пользователя: клиент
 * хранит всё своё локально, а первый же привет после рестарта сервера покажет
 * отставшие фейсы — и клиент дошлёт недостающее сам. Ровно поэтому серверу не
 * нужны ни append-only журнал, ни атомарная смена поколений: протокол
 * самовосстанавливающийся, диск сервера — кэш, а не единственная копия.
 *
 * Один инстанс — предусловие (личный сервер, docs/04): хаб живёт в памяти
 * процесса, второй процесс над тем же каталогом не предполагается.
 */

export interface Received {
  /** Ответ отправителю: дельты и наши фейсы по лендам, приславшим фейсы. */
  readonly reply: Uint8Array | null;
  /** Вещание соседям: ленд → пачка принятых юнитов. Только ленды, где что-то взято. */
  readonly spread: ReadonlyArray<readonly [string, Uint8Array]>;
  /** Все ленды, упомянутые в сообщении, — для подписки соединения. */
  readonly lands: readonly string[];
}

export interface Hub {
  receive(bytes: Uint8Array): Promise<Received>;
  /**
   * Забыть ленд: память и носитель. Единственная НЕ-append операция протокола —
   * отзыв устройства перезаливает ленд, перепечатанный новым секретом, а фейсы
   * сервера со старым содержимым мешали бы: клиентская дельта считала бы, что
   * всё уже доставлено.
   */
  wipe(land: string): Promise<void>;
  /** Дописать всё отложенное немедленно — для остановки процесса и тестов. */
  flush(): Promise<void>;
}

interface Slot {
  readonly id: LandId;
  readonly land: Land;
  timer: ReturnType<typeof setTimeout> | null;
}

const PEER_KEY = 'peer';
const PERSIST_DELAY = 1000;

function landKey(id: LandId): string {
  return `land:${id.str}`;
}

export function createHub(storage: Storage, persistDelay = PERSIST_DELAY): Hub {
  const slots = new Map<string, Promise<Slot>>();
  let peer: Promise<Link> | null = null;

  /**
   * Пир сервера: 8 случайных байт, один на каталог данных. Сервер ничего не
   * чеканит, но фейсам нужна стабильная идентичность между рестартами — иначе
   * каждый рестарт выглядел бы новым собеседником.
   */
  function serverPeer(): Promise<Link> {
    peer ??= (async () => {
      const raw = await storage.getItemRaw(PEER_KEY);
      if (raw !== null && raw !== undefined) return Link.peer(new Uint8Array(raw as Uint8Array));
      const fresh = new Uint8Array(8);
      crypto.getRandomValues(fresh);
      await storage.setItemRaw(PEER_KEY, fresh);
      return Link.peer(fresh);
    })();
    return peer;
  }

  function slotOf(id: LandId): Promise<Slot> {
    const key = id.str;
    const known = slots.get(key);
    if (known !== undefined) return known;

    const loading = (async (): Promise<Slot> => {
      const land = new Land(await serverPeer(), { now: () => Math.floor(Date.now() / 1000) });
      const stored = await storage.getItemRaw(landKey(id));
      if (stored !== null && stored !== undefined) {
        try {
          land.adopt(new Uint8Array(stored as Uint8Array));
        }
        catch (error) {
          // Битый образ — не потеря: клиенты дошлют всё по фейсам. Начинаем с
          // чистого ленда и честно говорим об этом в лог.
          console.error(`[brain] land image ${id.str} failed to parse, starting empty:`, error);
        }
      }
      return { id, land, timer: null };
    })();

    slots.set(key, loading);
    return loading;
  }

  /** Отложенная запись образа: одна на ленд, сдвигается каждым изменением. */
  function persistSoon(slot: Slot): void {
    if (slot.timer !== null) clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
      slot.timer = null;
      void persist(slot);
    }, persistDelay);
  }

  async function persist(slot: Slot): Promise<void> {
    const part = slot.land.part();
    try {
      await storage.setItemRaw(landKey(slot.id), packEncode([[slot.id, part]]));
    }
    catch (error) {
      console.error(`[brain] land image ${slot.id.str} failed to write:`, error);
    }
  }

  return {
    async receive(bytes: Uint8Array): Promise<Received> {
      const replyParts: PackParts = [];
      const spread: Array<[string, Uint8Array]> = [];
      const lands: string[] = [];

      for (const [id, part] of packDecode(bytes)) {
        const slot = await slotOf(id);
        lands.push(id.str);

        if (part.units.length > 0) {
          const taken = slot.land.apply(part.units, part.balls);
          if (taken > 0) {
            persistSoon(slot);
            // Соседям — ровно принятая секция: применение у них идемпотентно,
            // проигравшие LWW юниты погаснут там же, где погасли здесь.
            spread.push([id.str, packEncode([[id, packPart({ units: part.units, balls: part.balls })]])]);
          }
        }

        if (part.faces.length > 0) {
          const mine = slot.land.part();
          const delta = diffOf(mine, facesFromPack(part.faces));
          const faces = facesOf(mine);
          // Назваться обязаны и с пустыми руками — иначе клиент, у которого
          // есть непереданное, не узнает об этом (урок канала вкладок).
          const self = peerKey(slot.land.peer());
          if (!faces.has(self)) faces.set(self, { time: 0, tick: 0, summ: 0 });
          replyParts.push([id, packPart({ units: delta.units, balls: delta.balls, faces: facesToPack(faces) })]);
        }
      }

      return {
        reply: replyParts.length > 0 ? packEncode(replyParts) : null,
        spread,
        lands,
      };
    },

    async wipe(land: string): Promise<void> {
      const loading = slots.get(land);
      slots.delete(land);
      if (loading !== undefined) {
        const slot = await loading;
        if (slot.timer !== null) clearTimeout(slot.timer);
      }
      await storage.removeItem(`land:${land}`);
    },

    async flush(): Promise<void> {
      for (const loading of slots.values()) {
        const slot = await loading;
        if (slot.timer !== null) {
          clearTimeout(slot.timer);
          slot.timer = null;
          await persist(slot);
        }
      }
    },
  };
}
