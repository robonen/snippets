# 06. Хранилище

Один интерфейс, четыре реализации. Формат на диске — тот же `Pack`
([ADR-005](00-decisions.md#adr-005--один-бинарный-формат-для-провода-диска-и-дампа)).

---

## 1. Интерфейс

```ts
export interface UnitStore {
  /** Загрузить все юниты ленда. Может вернуть промис — файбер подождёт. */
  load(land: LandId): Promise<readonly Unit[]> | readonly Unit[]
  /** Атомарно применить дифф. */
  save(land: LandId, diff: { ins: readonly Unit[]; del: readonly Unit[] }): Promise<void>
  /** Ленивая догрузка большого значения. */
  ball(land: LandId, shot: Shot): Promise<Uint8Array>
  /** Удалить ленд целиком. */
  drop(land: LandId): Promise<void>
  /** Список известных лендов — для восстановления после перезагрузки. */
  lands(): Promise<readonly LandId[]>
}
```

Использование из ленда — синхронное, через файбер:

```ts
loading() {
  pin()
  const units = sync(() => this.ctx.store.load(this.id))
  this.applyUnits(units, 'trusted')
}
```

---

## 2. `memory` — для тестов и бенчей

Просто `Map<LandId, Set<Unit>>`. Синхронный, без промисов — благодаря этому
мультипировые тесты идут без `await` вообще.

---

## 3. `idb` — браузер по умолчанию

Две таблицы, ключ `[landId, unit.path()]`, значение — сырой `ArrayBuffer`.

```
Unit: [land, 'sand:head/peer/self'] → ArrayBuffer
Ball: [land, 'sand:head/peer/self'] → ArrayBuffer
```

Читается диапазоном `IDBKeyRange.bound([land, ''], [land, '￿'])` — один
курсор на ленд. Практически без изменений переносится из
[idbStore.ts](../../vue-sync-engine/lib/src/adapters/idbStore.ts) и
[idb.web.ts](../../baza/mine/idb/idb.web.ts).

Ограничение: одна вкладка должна быть писателем, иначе конкурирующие транзакции
дают лишнюю работу. Отсюда роль SharedWorker в [08](08-sync-protocol.md).

---

## 4. `fs` / `opfs` — арена с зеркалами

Самое интересное. Порт [fs.node.ts](../../baza/mine/fs/fs.node.ts).

### Арена

Файл ленда — это **валидный `Pack`**. Юниты лежат по офсетам, аллокатор
(`MemoryPool`) раздаёт слоты:

```
save(unit)  → offset = pool.acquire(align8(unit.byteLength)); write(unit, offset)
delete(unit)→ write(zeros, offset); pool.release(offset, size)
load()        → packDecode(file, { offsets, pool })   ← парсер сам восстанавливает пул
```

Освобождённый слот заполняется нулями; `kind = 0` = «свободно», парсер его
пропускает. Поэтому загрузка одновременно восстанавливает состояние аллокатора —
не нужен отдельный индекс свободных мест.

### Yin-Yan: атомарность без WAL

```ts
class Mirrors {
  constructor(readonly sides: [File, File]) {}

  loadInit() {                         // читать из более свежего
    if (mtime(sides[0]) < mtime(sides[1])) sides.reverse()
  }

  atomic(task: (tx: Tx) => void) {
    this.saveInit()                    // клонировать свежий в запасной
    const tx1 = sides[1].open('write'); task(tx1); tx1.flush(); tx1.close()
    this.sides.reverse()
    const tx2 = sides[1].open('write'); task(tx2); tx2.close()
  }
}
```

Инвариант: **в любой момент хотя бы одно зеркало консистентно**. Обрыв во время
записи первого — читаем второе; обрыв во время второго — первое уже записано и
`flush`-нуто.

Стоимость — двойная запись и двойной объём. Для локальной базы это дешевле, чем
WAL с компакцией.

### OPFS

То же самое поверх `FileSystemSyncAccessHandle` (доступен только в воркере —
что нам подходит, писатель и так один). Даёт производительность, недостижимую в
IndexedDB на больших объёмах.

---

## 5. Раскладка по каталогам

```
.sync/
  ab/                      первые 2 символа peer
    ab3f…9c.yin.pack
    ab3f…9c.yan.pack
    cd/                    последние 2 символа area — для под-лендов
      ab3f…9c_cd12…ef.yin.pack
      ab3f…9c_cd12…ef.yan.pack
```

Шардинг по префиксу — чтобы не упереться в лимит файлов в каталоге при десятках
тысяч лендов.

---

## 6. Что персистится и когда

```
post()  → юнит в память → пометка «не сохранён»
        → микрозадача → units_unsaved() → save()  (батчем)
        → broadcast в шину вкладок и в сеть
```

Сохранение батчами внутри тика, а не по юниту. Порт логики
`units_saving`/`units_unsaved` из [land.ts:1132](../../baza/land/land.ts#L1132).

**Важно:** подпись ставится **до** сохранения (`units_signing` → `units_saving`),
иначе после перезагрузки в базе окажутся неподписанные юниты, которые никуда
нельзя отправить.

---

## 7. Тесты

| Тест | Что |
|---|---|
| `store.roundtrip` | `save` → `load` даёт побайтово те же юниты |
| `store.arena` | после 10 000 случайных save/delete файл не растёт неограниченно |
| `store.kill9` | обрыв записи на каждом из 1000 случайных офсетов → второе зеркало валидно и не потеряло подтверждённых юнитов |
| `store.big` | ball > 32 МБ грузится лениво и не попадает в память при `load()` |
| `store.concurrent` | две вкладки пишут в IDB → нет потерянных юнитов |
| `store.bench` | 100 000 юнитов: время `load`, время `save` батчем, размер файла |

`store.kill9` — обязательный. Реализуется на `memfs`-подобной обёртке, которая
бросает после N записанных байт.
