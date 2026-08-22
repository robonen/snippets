// Точка входа только для бенчей.
//
// `src/index.ts` пока пуст: публичное API ленда не зафиксировано, а перф-гейт S3
// закрывать надо уже сейчас. Отдельная точка входа даёт бенчу доступ к нужным
// функциям, не заставляя раньше времени объявлять их публичными, — и не трогает
// бюджет размера пакета, который меряется по `src/index.ts`.
export { order } from '../src/land/order'
export { compare } from '../src/land/lww'
export { orderNaive, resolveNaive } from '../src/land/order-naive'
export { ROOT, type Sand } from '../src/land/sand'
export { Replica, fixedClock, type Clock } from '../src/land/replica'
// Боевой ленд S4: источник истины — байты (ADR-016). Экспортируется сюда, а не в
// `src/index.ts`, по той же причине, что и `Replica`: публичная поверхность слоя
// ещё не зафиксирована, а перф-гейт закрывать надо вместе с кодом.
export { Land } from '../src/land/land'
export { ROOT as LAND_ROOT, SandView, type LocalId } from '../src/land/view'
export { Link, LINK_BYTES, LINK_CHARS, LINK_ALPHABET, type LinkBytes, type LinkSource } from '../src/binary/link'
export { varyEncode, varyDecode, varyEqual, VaryError, type Vary } from '../src/binary/vary'
export {
  Unit,
  SandUnit,
  GiftUnit,
  SealUnit,
  PassUnit,
  UnitError,
  parseUnit,
  unitLength,
  shotKey,
  UNIT_AT,
  SAND_AT,
  UNIT_BYTES,
  UNIT_KIND,
  type AnyUnit,
  type UnitKind,
  type SandTag,
} from '../src/binary/unit'
// Вторая, независимая реализация разбора — она же эталон сверки. Живёт в
// `__tests__` и в `dist` пакета не попадает: точка входа бенча отдельная и в
// `src/index.ts` не входит, поэтому бюджет размера пакета не трогается.
export { referenceDecode, VaryMismatch, type RefVary } from '../src/binary/__tests__/vary-reference'
// То же для юнита: разбор по таблице офсетов §2 и два независимых компаратора —
// оракул по полям и обещанный §2 `memcmp` 14 байт.
export {
  readUnit,
  refCompare,
  memcmpCompare,
  refHex,
  UnitMismatch,
  type RefUnit,
} from '../src/binary/__tests__/unit-reference'
// Контейнер: `packEncode`/`packDecode` и всё, что нужно бенчу, чтобы собрать
// набор и восстановить арену (docs/03 §3, docs/06 §4).
export {
  packEncode,
  packDecode,
  packLength,
  packPart,
  PackError,
  PACK_AT,
  FACE_AT,
  PACK_BYTES,
  PACK_MAGIC,
  type LandId,
  type PackFace,
  type PackPart,
  type PackParts,
  type PackPool,
  type PackOpts,
} from '../src/binary/pack'
// Реактивное ядро — через ЭТУ точку входа, а не прямым импортом из бенча.
//
// Бандл бенча самодостаточен (`tsdown.bench.config.ts`), то есть несёт свою
// копию `@sync/fiber`. Возьми бенч `computed` напрямую из пакета — и в прогоне
// окажутся ДВА реактивных графа: сигнал ленда живёт в бандленной копии, активный
// подписчик — во внешней, `getActiveSub()` возвращает undefined, подписка не
// заводится вовсе. Гейт `invalidate/recomputed` ловит это мгновенно (1 → 0), но
// увидеть причину в числе невозможно, поэтому она записана здесь.
export { computed, ref, watchEffect, flush, batch, untracked } from '@sync/fiber'
// Слой моделей S4. Точка входа та же, что у ленда, и по той же причине: гейт
// закрывается вместе с кодом, а публичная поверхность ещё двигается.
export {
  atom,
  coreOf,
  createSpace,
  model,
  t,
  type Doc,
  type Head,
  type Issue,
  type Space,
} from '../src/model'
// Ссылки, части и `cast` — из своих файлов: общий barrel (`src/model/index.ts`)
// сводит владелец проекта после всех, а перф-гейт закрывается вместе с кодом.
export { cast } from '../src/model/cast'
export { link, links, list, part, text } from '../src/model/field'
// Коллекции: словарь, части по ключу и вложенный индекс — те же соображения.
export { dict, index, parts } from '../src/model/field'
// Хранилище S5. В бенч едет и память (эталон контракта, синхронная), и
// IndexedDB: бюджеты стадии («load 100 000 юнитов ≤ 500 мс», «save батчем 1000
// ≤ 30 мс») имеют смысл ТОЛЬКО на настоящей базе, то есть в Chromium, — числа с
// подделки в Node меряли бы чужую реализацию спецификации, а не платформу.
export { memoryStore, emptyPack, RamVolume } from '../src/store/memory'
export { idbStore, idbWipe } from '../src/store/idb'
export { openVault } from '../src/store/vault'
export { PackImage } from '../src/store/image'
export { Mirrors } from '../src/store/mirrors'
export { syncTabs, bcPort, randomSession } from '../src/wire/tabs'
export { facesOf, diffOf } from '../src/wire/face'
