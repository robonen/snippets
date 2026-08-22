// Перф-гейт моста в Vue — последняя незакрытая строка бюджета S1
// (docs/11-roadmap.md): 10 000 полей, точечное обновление → ровно один эффект, ≤ 1 мс.
import { measure } from 'mitata'
import { computed, flush, ref } from '@sync/fiber'
import { effectScope, nextTick as vueNextTick, watchEffect as vueWatchEffect } from 'vue'
import { createSync } from '../dist/index.js'

const fmt = (ns) => (ns < 1000 ? `${ns.toFixed(1)} ns` : `${(ns / 1000).toFixed(2)} µs`)
const fails = []

function check(name, ok, detail) {
  console.log(`${ok ? '✔' : '✘'} ${name} — ${detail}`)
  if (!ok) fails.push(name)
}

const FIELDS = 10_000

// ── Гранулярность: точечное обновление будит ровно один мост ─────────────────
{
  const sources = Array.from({ length: FIELDS }, (_, i) => ref(i))
  const derived = sources.map((source) => computed(() => source() * 2))

  let vueRuns = 0
  const scope = effectScope()
  const bridges = []

  scope.run(() => {
    for (const value of derived) {
      const bridge = createSync(() => value())
      bridges.push(bridge)
      vueWatchEffect(() => {
        vueRuns++
        void bridge.data.value
      })
    }
  })

  const afterSetup = vueRuns
  check(
    'первичная сборка',
    afterSetup === FIELDS,
    `${afterSetup} Vue-эффектов на ${FIELDS} полей`,
  )

  vueRuns = 0
  const started = process.hrtime.bigint()
  sources[FIELDS / 2](-1)
  flush()
  // У Vue своя очередь заданий: без неё замер учитывал бы только наш граф и
  // показывал ноль перезапусков там, где на самом деле один.
  await vueNextTick()
  const elapsedNs = Number(process.hrtime.bigint() - started)

  check(
    'точечное обновление будит ровно один мост',
    vueRuns === 1,
    `${vueRuns} Vue-эффектов (ожидался 1)`,
  )
  check(
    'задержка точечного обновления',
    elapsedNs <= 1_000_000,
    `${fmt(elapsedNs)} на ${FIELDS} полей (с очередью Vue), бюджет ≤ 1 мс`,
  )
  check(
    'значение доехало',
    bridges[FIELDS / 2].data.value === -2,
    `${bridges[FIELDS / 2].data.value}`,
  )

  scope.stop()
  for (const bridge of bridges) bridge.stop()
}

// ── Стоимость одного моста ───────────────────────────────────────────────────
{
  const source = ref(0)
  const value = computed(() => source() * 2)

  const create = await measure(() => {
    const bridge = createSync(() => value())
    bridge.stop()
    return bridge
  })
  console.log(`создание моста                  ${fmt(create.avg)}`)

  const bridge = createSync(() => value())
  let i = 0
  const update = await measure(() => {
    source(++i)
    flush()
  })
  console.log(`обновление через мост           ${fmt(update.avg)}`)
  bridge.stop()
}

if (fails.length > 0) {
  console.error(`\nПРОВАЛ: ${fails.length} проверок моста`)
  process.exit(1)
}
console.log('\nМост в Vue в бюджете')
