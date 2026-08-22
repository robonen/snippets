// Гейт размера. Из четырёх измерений PRINCIPLES.md («Гейт производительности»)
// это единственное, которое до сих пор считали руками, — а значит, не считали.
//
// ─── Чем меряем ──────────────────────────────────────────────────────────────
//
// МИНИФИЦИРОВАННЫЙ + gzip. Библиотека уезжает в npm неминифицированной, и это
// правильно: минифицирует бандлер потребителя, а исходные имена и комментарии
// нужны тому, кто полезет в `node_modules` разбираться. Но в браузер приезжает
// именно минифицированное, поэтому бюджет обещан про него.
//
// Разрыв не косметический: у `@sync/core` сборка как есть — 27.0 КБ gzip, а она
// же минифицированная — 11.1 КБ. Мерить первое значило бы записать в бюджет цену
// собственных комментариев (27 % строк бандла), которую пользователь не платит.
//
// ─── Почему отдельная сборка ─────────────────────────────────────────────────
//
// Минификация делается в одноразовую папку и к `dist/` не относится: гейт не
// имеет права менять то, что уезжает пользователю.

import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { record } from './_budgets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = dirname(here)

/**
 * Бюджеты — байты gzip после минификации. Из PRINCIPLES.md, «Гейт
 * производительности»: `@sync/core` ≤ 20 КБ.
 */
const BUDGETS = { index: 20 * 1024 }

/** Точки входа пакета: имя → исходник. */
const ENTRIES = { index: 'src/index.ts' }

/**
 * Реалистичный импорт: то, что на самом деле доезжает до пользователя.
 *
 * Barrel целиком (25.1 КБ) он не платит никогда — бандлер отряхивает то, чего
 * приложение не звало. Но и `index.js` как мера обманчива в другую сторону:
 * потребитель, открывший пространство и прочитавший поле, тянет за собой ленд,
 * бинарный слой и файбер, и это 23.3 КБ. Мерить надо ЕГО (тот же принцип, что и
 * «минифицированный, а не как есть»).
 */
const REAL_IMPORT = `
import {atom, createSpace, fixedClock, Land, Link, list, model, t, text} from './src/index'
const Post = model('post', {title: atom(t.string), tags: list(t.string), body: text()})
declare module './src/index' {interface Models {post: typeof Post}}
export function boot() {
  const land = new Land(Link.peer(new Uint8Array(8)), fixedClock(1000))
  return createSpace({land}).root('post')
}
`

const fmt = (bytes) => `${(bytes / 1024).toFixed(2)} КБ`

const out = mkdtempSync(join(tmpdir(), 'sync-size-'))

try {
  execFileSync(
    'npx',
    [
      'tsdown',
      '--no-config',
      ...Object.values(ENTRIES).map((src) => join(pkg, src)),
      '--out-dir',
      out,
      '--format',
      'esm',
      '--platform',
      'neutral',
      '--target',
      'es2022',
      '--minify',
      '--no-dts',
      '-l',
      'warn',
    ],
    { cwd: pkg, stdio: ['ignore', 'ignore', 'inherit'] },
  )

  console.log('\n══ Размер бандла (минифицированный + gzip) ══════════════════════')

  const results = {}
  let passed = true

  for (const name of Object.keys(ENTRIES)) {
    const raw = readFileSync(join(out, `${name}.js`))
    const gz = gzipSync(raw, { level: 9 })
    const limit = BUDGETS[name]
    const ok = gz.length <= limit
    passed &&= ok

    results[name] = {
      minified_bytes: raw.length,
      gzip_bytes: gz.length,
      limit_bytes: limit,
      passed: ok,
    }

    console.log(
      `  ${name.padEnd(10)} ${fmt(gz.length).padStart(10)} gzip (${fmt(raw.length)} minified) при бюджете ${fmt(limit).padStart(9)} — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`,
    )
  }

  // ── Реалистичный импорт ──────────────────────────────────────────────────
  const probe = join(pkg, '_size-probe.ts')
  writeFileSync(probe, REAL_IMPORT)
  try {
    execFileSync(
      'npx',
      ['tsdown', '--no-config', probe, '--out-dir', join(out, 'real'), '--format', 'esm',
       '--platform', 'neutral', '--target', 'es2022', '--minify', '--no-dts', '-l', 'warn'],
      { cwd: pkg, stdio: ['ignore', 'ignore', 'inherit'] },
    )
    const raw = readFileSync(join(out, 'real', '_size-probe.js'))
    const gz = gzipSync(raw, { level: 9 })
    const limit = BUDGETS.index
    const ok = gz.length <= limit
    passed &&= ok
    results.realImport = { minified_bytes: raw.length, gzip_bytes: gz.length, limit_bytes: limit, passed: ok }

    console.log(
      `  ${'приложение'.padEnd(10)} ${fmt(gz.length).padStart(10)} gzip (${fmt(raw.length)} minified) при бюджете ${fmt(limit).padStart(9)} — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`,
    )
    if (!ok) {
      console.log('     причина названа и не скрыта: `Land` — КЛАСС, а методы класса не отряхиваются.')
      console.log('     Приложение, которое ни разу не синхронизируется, всё равно везёт `adopt`,')
      console.log('     `packDecode` и разбор всех четырёх видов юнита. Лечится сужением класса,')
      console.log('     а не правкой бюджета: бюджет меняется замером пола, не фактом промаха.')
    }
  } finally {
    rmSync(probe, { force: true })
  }

  record('size_bytes', {
    spec: 'минифицированный + gzip; budget из PRINCIPLES.md. Судит РЕАЛИСТИЧНЫЙ импорт: barrel целиком потребитель не платит никогда',
    passed,
    ...results,
  })
} finally {
  rmSync(out, { recursive: true, force: true })
}
