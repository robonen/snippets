import { expect, test } from 'vitest'
import { atom, coreOf, createSpace, fixedClock, Land, Link, model, ROOT_HEAD, t, type Space } from '@sync/core'
import { defineComponent, h, createSSRApp, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createSync, installSpace, provideSpace, useDoc, useModel, useSpace } from './index'

const Note = model('vue-note', { title: atom(t.string) })

declare module '@sync/core' {
  interface Models {
    'vue-note': typeof Note
  }
}

function spaceOf(): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x31)), fixedClock(1000))
  return createSpace({ land })
}

test('useDoc: the same handle as space.doc — safe to pass as a prop', () => {
  const space = spaceOf()
  const root = useDoc(Note, undefined, space)
  expect(root).toBe(space.root(Note))
  expect(useDoc(Note, undefined, space)).toBe(root)
})

test('useModel: reads through the bridge, writes via a direct channel call', async () => {
  const space = spaceOf()
  const note = space.root(Note)
  note.title('до')

  const title = useModel(note.title)
  // Мост живёт на файберном наблюдателе — даём микрозадаче отработать.
  await nextTick()
  expect(title.value).toBe('до')

  title.value = 'после'
  expect(note.title()).toBe('после')

  // `undefined` из v-model записью не становится: сентинел один (docs/05 Р6).
  title.value = undefined
  expect(note.title()).toBe('после')
})

test('provideSpace/useSpace: the space travels down the component tree', async () => {
  const space = spaceOf()
  space.root(Note).title('из контекста')

  const Child = defineComponent({
    setup() {
      // Настоящий inject: без provideSpace в предке этот компонент бросил бы.
      const doc = useDoc(Note)
      const state = createSync(() => doc.title())
      return () => h('p', state.data.value ?? '')
    },
  })

  const App = defineComponent({
    setup() {
      provideSpace(space)
      return () => h(Child)
    },
  })

  const html = await renderToString(createSSRApp(App))
  expect(html).toContain('из контекста')
})

test('useSpace without a provider fails loudly', async () => {
  const Lone = defineComponent({
    setup() {
      expect(() => useSpace()).toThrow(/provideSpace/)
      return () => h('i')
    },
  })
  await renderToString(createSSRApp(Lone))
})

test('useDoc by address string — for routes', () => {
  const space = spaceOf()
  const root = space.root(Note)
  root.title('заголовок')

  // Строкой адресуется ПЕШКА, а не корень: у корня безымянного пространства
  // ссылка пуста, и это правильно — корень открывают `space.root`. Настоящий
  // адрес берём у ключевого юнита поля.
  const core = coreOf(space)
  const head = core.keyIndex(ROOT_HEAD).get('title')
  if (head === undefined) throw new Error('field key not found')

  const doc = space.doc(Note, head)
  const link = doc.$.link()
  expect(link.str.length).toBeGreaterThan(0)
  expect(useDoc(Note, link.str, space)).toBe(doc)
})

test('installSpace: app-level provision, without setup context', async () => {
  const space = spaceOf()
  space.root(Note).title('с уровня приложения')

  const Child = defineComponent({
    setup() {
      const doc = useDoc(Note)
      const state = createSync(() => doc.title())
      return () => h('p', state.data.value ?? '')
    },
  })

  const app = createSSRApp(Child)
  installSpace(app, space)
  expect(await renderToString(app)).toContain('с уровня приложения')
})
