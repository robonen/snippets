// Кросс-табная синхронизация: сырые паки через BroadcastChannel (docs/08 §5).
//
// ─── Протокол — три вида пачки и ни одного типа сообщений ────────────────────
//
// Всё, что летит по каналу, — это пачка формата docs/03 §3, и её наполнение само
// говорит, что это (таблица семантики там же):
//
//   faces ✓ units ✗   «вот моё состояние» — привет вошедшей вкладки
//   faces ✓ units ✓   ответ на привет: дельта + наши фейсы
//   faces ✗ units ✓   просто новое — течёт по мере появления
//
// Вошедшая вкладка шлёт привет со своими фейсами. Каждая живая вкладка отвечает
// дельтой ПЛЮС своими фейсами — и по этим фейсам вошедшая считает встречную
// дельту: то, что появилось у неё, пока канал молчал. Ответ на ответ — только
// юниты, поэтому цепочка обрывается сама: реплику порождают ТОЛЬКО фейсы.
//
// Дальше живёт один поток: собственные записи уезжают краном ленда
// (`Land.tap`) по микрозадаче. Чужое не пересылается вовсе — на общем канале
// каждый слышал оригинал, и пересылка была бы эхом.
//
// ─── Почему `apply`, а не `adopt` ────────────────────────────────────────────
//
// `adopt` берёт буфер главой арены и сваливает в ленд юниты ВСЕХ лендов пачки —
// записанная дыра S4. `apply` разбирает пачку по частям, применяет только свою и
// копирует байты: чужой буфер из канала не обязан жить дольше обработчика.
//
// ─── Чего здесь нет и почему ─────────────────────────────────────────────────
//
// Выбора писателя. Каждая вкладка, у которой открыт `openVault`, пишет в своё
// хранилище всё услышанное — двум вкладкам над ОДНОЙ базой IndexedDB это даст
// перезапись друг друга (записанное ограничение S5: «одна вкладка — писатель»).
// Выбор писателя через Web Locks — работа wire-sw (S8), а не канала вкладок.

import { packDecode, packEncode, packPart, type LandId } from '../binary/pack'
import type { Land } from '../land/land'
import { behindOf, diffOf, facesFromPack, facesOf, facesToPack, peerKey } from './face'

/** Канал как он нужен синхронизации (docs/08 §3). Всё, что летит, — пачка. */
export interface Port {
  send(bytes: Uint8Array): void
  onMessage(handle: (bytes: Uint8Array) => void): () => void
  close(): void
}

/**
 * Сеанс чеканки для `LandOptions.session` (ADR-017) — 24 случайных бита.
 *
 * Живёт здесь, а не в ленде, намеренно: ядро детерминировано, энтропию даёт
 * обвязка — по той же причине, по которой часы инжектятся снаружи. Каждый
 * ОДНОВРЕМЕННО живой экземпляр ленда одного пира обязан получить свой сеанс,
 * иначе вкладки чеканят одинаковые `self` и правки молча проигрывают арбитраж.
 */
export function randomSession(): number {
  const bin = new Uint8Array(3)
  globalThis.crypto.getRandomValues(bin)
  return ((bin[0] as number) << 16) | ((bin[1] as number) << 8) | (bin[2] as number)
}

/** Порт поверх `BroadcastChannel`: имя канала — ленд, содержимое — сырые пачки. */
export function bcPort(name: string): Port {
  const channel = new BroadcastChannel(name)
  const handlers = new Set<(bytes: Uint8Array) => void>()

  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as ArrayBuffer
    // Копия обязательна: буфер события может быть переиспользован платформой, а
    // `apply` читает байты после возврата из обработчика только через свою арену.
    const bytes = new Uint8Array(data.slice(0))
    for (const handle of handlers) handle(bytes)
  }

  return {
    send(bytes: Uint8Array): void {
      // Структурное клонирование `ArrayBuffer` — без JSON и без копий сверх той,
      // что делает сама платформа. Ровный буфер уходит как есть, окно — срезом.
      const clean = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      channel.postMessage(clean ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    },
    onMessage(handle: (bytes: Uint8Array) => void): () => void {
      handlers.add(handle)
      return () => {
        handlers.delete(handle)
      }
    },
    close(): void {
      handlers.clear()
      channel.close()
    },
  }
}

export interface SyncTabsOptions {
  readonly land: Land
  readonly id: LandId
  /** Свой порт — для тестов и не-BC транспортов. По умолчанию — `bcPort`. */
  readonly port?: Port
  /** Куда сообщать о браке в канале. По умолчанию — `console.error`. */
  readonly report?: (error: unknown) => void
}

export interface TabSync {
  readonly id: LandId
  /** Отключиться: снять кран, закрыть порт. Ленд остаётся жив. */
  close(): void
}

/**
 * Включить ленд в канал вкладок.
 *
 * @example
 * ```ts
 * const land = new Land(peer, clock, { session: randomSession() })
 * const sync = syncTabs({ land, id })
 * // …
 * sync.close()
 * ```
 */
export function syncTabs(options: SyncTabsOptions): TabSync {
  const { land, id } = options
  const report = options.report ?? ((error: unknown) => console.error('[@sync/core] tabs channel:', error))
  const port = options.port ?? bcPort(`sync:land:${id.str}`)
  const ours = id.str

  // Фейсы для отправки — всегда со СВОИМ пиром, даже нулевым. Привет пустой
  // вкладки иначе не содержал бы ни одного фейса и побайтово совпадал бы с
  // отпиской (faces ✗ units ✗) — старожилы бы молчали, и вошедшая не получила
  // бы ничего. Нулевой фейс говорит «я здесь и видел ноль»: этого достаточно,
  // чтобы ответ состоялся, а отставанием он не считается (`behindOf`).
  const named = (): ReturnType<typeof facesOf> => {
    const faces = facesOf(land.part())
    const self = peerKey(land.peer())
    if (!faces.has(self)) faces.set(self, { time: 0, tick: 0, summ: 0 })
    return faces
  }

  // Собственные записи — краном, пачка на микрозадачу.
  const untap = land.tap(id, (pack) => port.send(pack))

  const unsub = port.onMessage((bytes) => {
    try {
      for (const [pid, part] of packDecode(bytes)) {
        if (pid.str !== ours) continue

        if (part.units.length > 0) land.apply(part.units, part.balls)

        // Фейсы — просьба о дельте: и в привете, и в ответе на него.
        if (part.faces.length > 0) {
          const mine = land.part()
          const theirs = facesFromPack(part.faces)
          const delta = diffOf(mine, theirs)

          if (delta.units.length > 0) {
            // Есть что послать. Если это был ПРИВЕТ (юнитов не было) — кладём и
            // свои фейсы: по ним собеседник посчитает встречную дельту. Ответ на
            // ответ — только юниты, и цепочка обрывается: реплику порождают
            // ТОЛЬКО фейсы.
            const faces = part.units.length === 0 ? facesToPack(named()) : []
            port.send(packEncode([[id, packPart({ units: delta.units, balls: delta.balls, faces })]]))
          } else if (part.units.length === 0 && behindOf(facesOf(mine), theirs)) {
            // Послать нечего, но по фейсам видно, что отстали МЫ. Назваться
            // обязательно: иначе собеседник не узнает, что это ему есть что
            // слать, и направление «вошедший → старожил» умрёт молча.
            //
            // Обрыв цепочки держится на том, что «мы отстали» и «дельта пуста»
            // несовместимы навсегда: собеседник, получив наши фейсы, посчитает
            // НЕПУСТУЮ дельту (мы отстали — значит у него есть новое для нас),
            // ответит юнитами — а ответ с юнитами реплик не порождает.
            port.send(packEncode([[id, packPart({ faces: facesToPack(named()) })]]))
          }
        }
      }
    } catch (error) {
      report(error)
    }
  })

  // Привет: наши фейсы, ни одного юнита — «вот моё состояние, чего мне не хватает?»
  port.send(packEncode([[id, packPart({ faces: facesToPack(named()) })]]))

  return {
    id,
    close(): void {
      untap()
      unsub()
      port.close()
    },
  }
}
