// Страница в Chromium: http-сервер на localhost плюс playwright.
//
// ВТОРАЯ КОПИЯ, И ЭТО НАМЕРЕННО. Тот же сервер живёт в `cross.mjs`; по правилу
// трёх повторений (PRINCIPLES.md, «Абстракции») два похожих места — это копия с
// комментарием, а не выделение. Появится третий потребитель — `cross.mjs`
// переезжает сюда, и тогда выделение будет оправдано сущностной сложностью, а
// не сходством формы.
//
// ПОЧЕМУ ВООБЩЕ СЕРВЕР: странице нужен origin. Без него в ней невозможен ни
// `import()`, ни IndexedDB — `file://` и `about:blank` не имеют происхождения, а
// значит и хранилища. Грузить бандл строкой значило бы мерить не то, что мы
// собираем.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' }

/** Раздаёт `packages/core` на localhost. Только чтение, только внутри корня. */
async function serve() {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(
        '<!doctype html><meta charset="utf-8"><title>bench</title>'
          + '<script type="importmap">{"imports":{'
          + '"@sync/fiber":"/_fiber/index.js",'
          + '"alien-signals/system":"/_alien/system.mjs"'
          + '}}</script>',
      )
      return
    }

    if (path.startsWith('/_fiber/') || path.startsWith('/_alien/')) {
      const inner = path.startsWith('/_fiber/')
        ? normalize(join(root, '..', 'fiber', 'dist', path.slice('/_fiber/'.length)))
        : normalize(join(root, '..', 'fiber', 'node_modules', 'alien-signals', 'esm', path.slice('/_alien/'.length)))
      readFile(inner).then(
        (body) => {
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
          res.end(body)
        },
        () => res.writeHead(404).end(),
      )
      return
    }

    const file = normalize(join(root, path))
    if (!file.startsWith(root)) {
      res.writeHead(403).end()
      return
    }

    readFile(file).then(
      (body) => {
        const dot = file.lastIndexOf('.')
        res.writeHead(200, { 'content-type': TYPES[file.slice(dot)] ?? 'application/octet-stream' })
        res.end(body)
      },
      () => res.writeHead(404).end(),
    )
  })

  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

/**
 * Поднять Chromium и выполнить `task({ origin, fresh })`.
 *
 * `fresh()` даёт страницу в ЧИСТОМ контексте — со своим, пустым хранилищем.
 * Это не удобство, а требование замера: IndexedDB в Chromium ДОРОЖАЕТ по ходу
 * работы с ней. Канарейка (одна и та же транзакция голого IDB до и после
 * прогона) показала дрейф ×10.4 при базе на замер и ×23.7 при одной общей базе
 * — то есть в один контекст можно уместить ровно один раздел, иначе числа
 * следующего меряют износ хранилища предыдущего.
 *
 * Всё, что вернёт `task`, обязано быть JSON — граница между движками проходит
 * по структурному клону.
 */
export async function inChromium(task) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const { server, origin } = await serve()
  const errors = []

  async function fresh() {
    const context = await browser.newContext()
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(origin)
    return { page, close: () => context.close() }
  }

  try {
    const out = await task({ origin, fresh })
    if (errors.length > 0) throw new Error(errors.join('\n'))
    return out
  } finally {
    await browser.close()
    server.close()
  }
}

/** Отличить «браузера на машине нет» от «наш код не поехал». Разные исходы. */
export function noBrowser(failure) {
  return /playwright|executable doesn't exist|browserType\.launch|Cannot find package/i.test(failure ?? '')
}
