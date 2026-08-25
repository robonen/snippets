/**
 * `@sync/core` — ядро local-first CRDT.
 *
 * Наружу открыт **бинарный слой** (стадия S2): ссылки, кодек значений, юниты и
 * пачки. Это один формат для провода, диска и дампа ([ADR-005](../../../docs/00-decisions.md)),
 * и он закрыт: golden-векторы зафиксированы, побайтовое совпадение Node и
 * Chromium проверено, каждый кодек сверен с независимой второй реализацией.
 *
 * Слой ленда открыт ЧАСТИЧНО и осознанно: наружу идёт `Land` — тот самый, что
 * описан в [docs/04 §1](../../../docs/04-crdt-core.md) и построен по
 * [ADR-016](../../../docs/00-decisions.md) на байтах. Без него нельзя вызвать
 * `createSpace`, потому что `SpaceOptions.land` — обязательное поле: тип
 * аргумента публичной функции обязан быть достижим по имени.
 *
 * НЕ открыты и открыты не будут: `Replica` и `orderNaive` — это испытательный
 * стенд стадии S3 и наивный оракул, они живут ради дифференциальной сверки, а не
 * ради потребителя; и внутренности вида (`cmpAt`, `id48`, офсеты) — их читает
 * тот, кто пишет свой разбор формата, и берёт из спецификации, а не из пакета.
 *
 * Смещения полей (`UNIT_AT`, `PACK_AT` и прочие) тоже оставлены внутри: они
 * нужны тому, кто пишет свой разбор формата, а такой читатель берёт их из
 * спецификации [03](../../../docs/03-binary-format.md), а не из чужого пакета.
 */

export { Link, LINK_BYTES, LINK_CHARS, type LinkBytes, type LinkSource } from './binary/link'

export { varyDecode, varyEncode, varyEqual, VaryError, type Vary } from './binary/vary'

export {
  GiftUnit,
  PassUnit,
  parseUnit,
  SandUnit,
  SealUnit,
  SHOT_BYTES,
  shotKey,
  Unit,
  UnitError,
  unitLength,
  type AnyUnit,
  type GiftFields,
  type PassAlgo,
  type PassFields,
  type SandBigFields,
  type SandFields,
  type SandTag,
  type SealFields,
  type UnitKind,
  type UnitStamp,
} from './binary/unit'

export { Land, type LandOptions } from './land/land'
export { fixedClock, type Clock, type FixedClock } from './land/clock'
export { ROOT as LAND_ROOT, SandView, type LocalId } from './land/view'

export {
  packDecode,
  packEncode,
  PackError,
  packLength,
  packPart,
  type LandId,
  type PackFace,
  type PackOpts,
  type PackParts,
  type PackPart,
  type PackPool,
} from './binary/pack'

/**
 * Хранилище (стадия S5): контракт, память, IndexedDB и связка ленда с
 * хранилищем — гидрация с приостановкой и автосохранение батчами.
 */
export {
  ambientIdb,
  emptyPack,
  idbStore,
  idbWipe,
  memoryStore,
  openVault,
  StoreError,
  type Awaitable,
  type IdbFactory,
  type IdbRanges,
  type IdbStore,
  type IdbStoreOptions,
  type MemoryStore,
  type MemoryStoreOptions,
  type UnitStore,
  type Vault,
  type VaultOptions,
  type Volume,
} from './store/index'

/**
 * Крипта (стадия S6, конфиденциальность): секрет ленда, запечатывание payload
 * на уровне юнита (заголовки открыты — пир без ключа сливает и досылает ленд,
 * который не может прочитать), обёртка хранилища и обмен секретами через ECDH.
 * Подписи (`Seal`) и ранги — следующий шаг той же стадии (docs/07).
 */
export { mintSecret, secretKey, SECRET_BYTES } from './crypto/secret'
export type { SubtleKey, SubtleKeyPair } from './crypto/keys'
export { CryptoError, openPack, sealPack, type PackKeys, type SecretRing } from './crypto/sealed'
export { sealedStore } from './crypto/store'
export {
  identityOf,
  mintExchangePair,
  unwrapSecret,
  wrapSecret,
  type ExchangeAlgo,
  type Identity,
} from './crypto/identity'

/**
 * Синхронизация вкладок (стадия S7, wire-bc): сырые пачки через
 * `BroadcastChannel`, привет фейсами, дельта по водяному знаку с `Fail Summ`.
 * Каждый одновременно живой ленд одного пира обязан получить свой
 * `randomSession()` (ADR-017).
 */
export { bcPort, randomSession, syncTabs, type Port, type SyncTabsOptions, type TabSync } from './wire/tabs'
export { exchange, helloPack, landIdOf, type Exchange } from './wire/exchange'
export { behindOf, diffOf, facesFromPack, facesOf, facesToPack, peerKey, type Diff, type Face } from './wire/face'

/**
 * Слой моделей (стадия S4): значения, реестр, документ, пространство и все девять
 * видов поля — атом, список, словарь, текст, ссылка, ссылки, часть, части и
 * индекс, — плюс `cast` как перевод вида без миграции данных.
 *
 * Реестр `Models` расширяется слиянием объявлений ПО ЭТОМУ имени модуля:
 *
 * ```ts
 * declare module '@sync/core' {
 *   interface Models {post: typeof Post}
 * }
 * ```
 */
export {
  atom,
  cast,
  CORE,
  coreOf,
  createSpace,
  describe as describeVary,
  dict,
  extend,
  index,
  link,
  links,
  list,
  model,
  modelOf,
  ModelError,
  part,
  parts,
  ROOT_HEAD,
  SPOT,
  t,
  text,
  warnIssue,
  type AnyModel,
  type AtomChannel,
  type AtomField,
  type Born,
  type Caret,
  type Cast,
  type CastFrom,
  type Chan,
  type Depth,
  type DerivedChannel,
  type Derives,
  type DictChannel,
  type DictField,
  type Doc,
  type DocOps,
  type Field,
  type FieldKind,
  type Handle,
  type Head,
  type IndexChannel,
  type IndexField,
  type Issue,
  type IssueKind,
  type Key,
  type LinkChannel,
  type LinkField,
  type LinksChannel,
  type LinksField,
  type ListChannel,
  type ListField,
  type Model,
  type ModelName,
  type Models,
  type PartChannel,
  type PartField,
  type PartsChannel,
  type PartsField,
  type Peer,
  type Point,
  type ReservedFieldName,
  type Schema,
  type Space,
  type SpaceCore,
  type SpaceOptions,
  type Spot,
  type TextChannel,
  type TextField,
  type Type,
  type View,
} from './model'
