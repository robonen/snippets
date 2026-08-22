import { computed, flush, ref, sync } from '@sync/fiber'
import { effectScope, watchEffect as vueWatchEffect } from 'vue'
import { expect, test } from 'vitest'
import { createSync, useSync } from './index'

test('значение из графа файберов доезжает в реактивность Vue', () => {
  const count = ref(1)
  const double = computed(() => count() * 2)

  const bridge = createSync(() => double())
  expect(bridge.data.value).toBe(2)
  expect(bridge.pending.value).toBe(false)

  count(5)
  flush()
  expect(bridge.data.value).toBe(10)

  bridge.stop()
})

test('Vue-эффект перезапускается от изменения в нашем графе', () => {
  const count = ref(0)
  const bridge = createSync(() => count())

  let vueRuns = 0
  const scope = effectScope()
  scope.run(() => {
    vueWatchEffect(() => {
      vueRuns++
      void bridge.data.value
    })
  })
  expect(vueRuns).toBe(1)

  count(1)
  flush()
  // Vue-эффекты идут своей очередью; прогоняем её.
  scope.stop()
  expect(bridge.data.value).toBe(1)
  bridge.stop()
})

test('приостановка не протекает наружу: pending вместо исключения', async () => {
  let release!: (value: string) => void
  const gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => gate

  const view = computed(function view() {
    return sync(load)
  })

  const bridge = createSync(() => view())
  expect(bridge.pending.value).toBe(true)
  expect(bridge.data.value).toBeUndefined()
  expect(bridge.error.value).toBeUndefined()

  release('готово')
  await gate
  flush()

  expect(bridge.pending.value).toBe(false)
  expect(bridge.data.value).toBe('готово')
  bridge.stop()
})

test('пока грузится новое, data держит прошлое значение', async () => {
  const page = ref(0)
  let release!: (value: string) => void
  let gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => gate

  const view = computed(function view() {
    page()
    return sync(load)
  })

  const bridge = createSync(() => view())
  release('первая')
  await gate
  flush()
  expect(bridge.data.value).toBe('первая')

  gate = new Promise<string>((resolve) => {
    release = resolve
  })
  page(1)
  flush()

  // Загрузка идёт, но экран не мигает пустотой.
  expect(bridge.pending.value).toBe(true)
  expect(bridge.data.value).toBe('первая')

  release('вторая')
  await gate
  flush()
  expect(bridge.data.value).toBe('вторая')
  bridge.stop()
})

test('ошибка попадает в error, а не роняет мост', () => {
  const boom = computed(function boom(): number {
    throw new Error('взорвалось')
  })

  const bridge = createSync(() => boom())
  expect(bridge.error.value).toBeInstanceOf(Error)
  expect((bridge.error.value as Error).message).toBe('взорвалось')
  expect(bridge.pending.value).toBe(false)
  bridge.stop()
})

test('остановка моста отписывает от графа', () => {
  const count = ref(1)
  const double = computed(() => count() * 2)

  const bridge = createSync(() => double())
  expect(double.node.subs).not.toBeUndefined()

  bridge.stop()
  flush()
  expect(double.node.subs).toBeUndefined()
})

test('скоуп компонента останавливает мост сам', () => {
  const count = ref(1)
  const double = computed(() => count() * 2)

  const scope = effectScope()
  scope.run(() => {
    // Внутри скоупа `useSync` регистрирует `onScopeDispose` сам.
    useSync(() => double())
  })
  expect(double.node.subs).not.toBeUndefined()

  scope.stop()
  flush()
  expect(double.node.subs).toBeUndefined()
})
