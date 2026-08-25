// Хранилище поверх шифртекста: та же дисциплина границы, что у провода.
//
// Память ленда — открытые юниты (синхронное чтение, ADR-002, живёт как жило);
// носитель — запечатанные. Обёртка ровно это и делает: `save` запечатывает
// пачку перед внутренним хранилищем, `load` распечатывает после. Внутреннему
// хранилищу всё равно: арена, зеркала и слоты работают по заголовкам юнитов, а
// заголовки у запечатанной формы открыты — журналов, поколений и компакций
// поверх шифрования не появляется (ровно их пришлось городить brain'у первой
// редакции, где печать стояла на границе ПАЧКИ).

import type { LandId } from '../binary/pack'
import type { Awaitable, UnitStore } from '../store/store'
import { openPack, sealPack, type SecretRing } from './sealed'

/**
 * Обернуть хранилище запечатыванием.
 *
 * @example
 * ```ts
 * const store = sealedStore(idbStore(), ring)
 * const vault = openVault({ store, id, land })   // ленд в памяти открытый, на диске — шифртекст
 * ```
 */
export function sealedStore(inner: UnitStore, ring: SecretRing): UnitStore {
  return {
    async load(land: LandId): Promise<Uint8Array> {
      return openPack(await inner.load(land), ring)
    },

    async save(land: LandId, pack: Uint8Array): Promise<void> {
      return inner.save(land, await sealPack(pack, ring))
    },

    async ball(land: LandId, shot: Uint8Array): Promise<Uint8Array | undefined> {
      const key = await ring.secretOf(land)
      // У запечатанного ленда `shot` открытой формы на носителе не встречается:
      // там лежит хэш ШИФРТЕКСТА. Переводить один в другой без подъёма ленда
      // нечем, поэтому честный ответ — «нет значения»; ручка остаётся живой для
      // открытых лендов и для S7-досылки.
      if (key !== null) return undefined
      return inner.ball(land, shot)
    },

    drop(land: LandId): Awaitable<void> {
      return inner.drop(land)
    },

    lands(): Awaitable<readonly LandId[]> {
      return inner.lands()
    },
  }
}
