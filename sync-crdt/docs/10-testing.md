# 10. Тестирование

Самая ценная идея, украденная у baza, — **мультипировые тесты в одном процессе**.
Она не зависит ни от $mol, ни от CRDT и переносится первой ([S0](11-roadmap.md)).

---

## 1. Харнесс

```ts
// packages/core/test/harness.ts

export function makeNode(seed: number, opts?: Partial<Ctx>): Node {
  return createNode({
    store: memoryStore(),
    clock: fakeClock(seed),          // детерминированное время
    identity: testIdentity(seed),       // ключи из фиксированного сида
    log: silentLog(),
    ...opts,
  })
}

/** Односторонняя доставка дельты */
export function deliver(from: Node, to: Node, land: LandId): void {
  const part = from.land(land).diff(to.land(land).faces)
  to.land(land).applyPack(packEncode([[land, part]]))
  flush()                                  // прогнать граф файберов синхронно
}

/** Двусторонняя доставка до неподвижной точки */
export function converge(land: LandId, ...nodes: Node[]): void {
  for (let round = 0; round < 16; round++) {
    let moved = false
    for (const a of nodes) for (const b of nodes) {
      if (a === b) continue
      if (deliverIfAny(a, b, land)) moved = true
    }
    if (!moved) return
  }
  throw new Error('Не сошлось за 16 раундов')
}

/** Сравнение наблюдаемого состояния */
export function readAll(node: Node, land: LandId): unknown {
  return node.land(land).dump()          // канонический JSON состояния
}
```

Три вещи делают это возможным:
1. **явный `Ctx`** вместо глобалов ([ADR-010](00-decisions.md#adr-010--явный-di-вместо-ambient-контекста));
2. **синхронный `memoryStore`** — ни одного `await` в тесте;
3. **`flush()`** из рантайма — граф прогоняется на месте, без таймеров.

Базовый тест выглядит так:

```ts
test('слияние правок', () => {
  const a = makeNode(1), b = makeNode(2)
  const land = a.grab()

  a.land(land).doc(Post).title('из A')
  b.land(land).doc(Post).tags().add('из B')

  converge(land, a, b)

  expect(readAll(a, land)).toEqual(readAll(b, land))
  expect(b.land(land).doc(Post).title()).toBe('из A')
})
```

---

## 2. Property-тесты (fast-check)

Основной инструмент доказательства корректности CRDT.

```ts
const opArb = fc.oneof(
  fc.record({ kind: fc.constant('set'), field: fc.constantFrom('title', 'body'), value: fc.string() }),
  fc.record({ kind: fc.constant('push'), value: fc.string() }),
  fc.record({ kind: fc.constant('del'), at: fc.nat(10) }),
  fc.record({ kind: fc.constant('move'), from: fc.nat(10), to: fc.nat(10) }),
)

const scheduleArb = fc.array(fc.tuple(fc.nat(4), fc.nat(4)), { maxLength: 200 })

test.prop([fc.array(fc.tuple(fc.nat(4), opArb), { maxLength: 200 }), scheduleArb])(
  'все узлы сходятся',
  (ops, schedule) => {
    const nodes = Array.from({ length: 5 }, (_, i) => makeNode(i))
    const land = nodes[0].grab()
    for (const [n, op] of ops) apply(nodes[n], land, op)
    for (const [from, to] of schedule) deliverIfAny(nodes[from], nodes[to], land)
    converge(land, ...nodes)
    const first = readAll(nodes[0], land)
    for (const n of nodes) expect(readAll(n, land)).toEqual(first)
  },
)
```

Проверяемые свойства — таблица в [04 §6](04-crdt-core.md#6-свойства-которые-обязаны-выполняться).

**Обязательно:** сохранять контрпримеры. `fast-check` умеет сериализовать сид —
каждый упавший прогон превращается в именованный регрессионный тест в
`__tests__/regressions/`.

---

## 3. Уровни тестов

| Уровень | Что | Инструмент | Где гоняем |
|---|---|---|---|
| **L1 unit** | кодек, офсеты, компараторы | vitest, node | каждый коммит |
| **L2 property** | сходимость, идемпотентность | vitest + fast-check | каждый коммит, 100 прогонов |
| **L2+ nightly** | то же, 10 000 прогонов | CI cron | ночью |
| **L3 runtime** | порт `../mol/wire/*.test.ts` | vitest | каждый коммит |
| **L4 storage** | kill-9, арена, конкуренция | vitest + memfs | каждый коммит |
| **L5 browser** | IDB, OPFS, BroadcastChannel, WebCrypto | vitest browser mode (уже настроен в [vitest.config.ts](../../vue-sync-engine/lib/vitest.config.ts)) | каждый коммит |
| **L6 network** | потери, реордер, партиции | фейковый транспорт | каждый коммит |
| **L7 jepsen-lite** | партиции + часы назад + рестарты | отдельный сценарный раннер | ночью |
| **L8 bench** | ops/sec, память, размер | mitata | перед релизом |

---

## 4. Готовый корпус для переиспользования

Переносится почти механически:

| Источник | Строк | Что даёт |
|---|---|---|
| `../mol/wire/solo.test.ts` | 644 | семантика каналов, Suspense, перезапуски |
| `../mol/wire/fiber.test.ts` | 107 | жизненный цикл файбера |
| `../mol/wire/{task,sync,async,plex,dict,set,field}.test.ts` | ~450 | границы и коллекции |
| `../baza/list/list.test.ts` | 520 | список: splice/reconcile/merge |
| `../baza/{atom,dict,text,cast,unit,pack,link,land,glob}` тесты | ~1000 | ядро CRDT |

**~2700 строк готовых спецификаций.** Это самая дешёвая гарантия того, что мы
воспроизвели модель, а не написали что-то похожее.

---

## 5. Jepsen-lite

Сценарный раннер поверх фейковой сети:

```ts
scenario('split brain + clock skew', {
  nodes: 5,
  steps: [
    { at: 0,    do: 'partition', groups: [[0,1],[2,3,4]] },
    { at: 0,    do: 'load', ops: 500 },
    { at: 2000, do: 'clockSkew', node: 2, delta: -3600 },   // часы назад на час
    { at: 4000, do: 'crash', node: 3 },
    { at: 5000, do: 'restart', node: 3 },                    // должен подняться из стора
    { at: 6000, do: 'heal' },
],
  assert: ['converged', 'noLostWrites', 'monotonicClock'],
})
```

`clockSkew` назад — важный сценарий: генератор меток должен удержать монотонность
за счёт того, что видел время сети ([04 §3](04-crdt-core.md#3-lww)).

---

## 6. Что считается «готово»

Пакет не считается готовым, пока не выполнено всё:

- [ ] L1–L6 зелёные на Node и в Chromium;
- [ ] L2 nightly — 10 000 прогонов без падений подряд трижды;
- [ ] покрытие ветвей ≥ 85 % на `core` (не строк — ветвей: тут важны редкие пути);
- [ ] golden-vectors зафиксированы и не менялись с прошлого релиза;
- [ ] бенчмарк не деградировал больше чем на 10 % от предыдущего релиза;
- [ ] у каждого упавшего в истории property-теста есть регрессия в `__tests__/regressions/`.
