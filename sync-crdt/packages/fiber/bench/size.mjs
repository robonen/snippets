// Гейт размера. Из четырёх измерений PRINCIPLES.md («Гейт производительности»)
// это единственное, которое до сих пор считали руками, — а значит, не считали.
//
// Здесь оно стоит дороже, чем в `@sync/core`: бюджет ядра — 4 КБ, и однажды его
// уже пробили. Инспектор графа добавлял 1.1 КБ и выводил сборку на 4.45 КБ;
// поэтому он вынесен отдельной точкой входа `@sync/fiber/inspect` и в прод не
// уезжает. Без автоматической проверки такое возвращается молча.
//
// ─── Чем меряем ──────────────────────────────────────────────────────────────
//
// МИНИФИЦИРОВАННЫЙ + gzip: в npm пакет уезжает как есть (минифицирует бандлер
// потребителя, а читаемые имена нужны тому, кто полезет в `node_modules`), но в
// браузер приезжает минифицированное — про него и обещание.
//
// Точки входа меряются ПОРОЗНЬ и каждая своим бюджетом. Мерить их суммой значило
// бы наказывать за само существование отладочного входа, которого в прод-сборке
// нет; мерить только главный — не заметить, как инспектор снова прирос к ядру.

import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { record } from './_budgets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = dirname(here)

/**
 * Бюджеты — байты gzip после минификации.
 *
 * `index` — из PRINCIPLES.md: `@sync/fiber` ≤ 4 КБ. `inspect` — свой, 2 КБ:
 * отладочный вход не обязан быть крошечным, но обязан оставаться отдельным.
 */
const BUDGETS = { index: 4 * 1024, inspect: 2 * 1024 }

const ENTRIES = { index: 'src/index.ts', inspect: 'src/inspect.ts' }

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

  record('size_bytes', {
    spec: 'минифицированный + gzip; точки входа меряются порознь, каждая своим бюджетом',
    passed,
    ...results,
  })
} finally {
  rmSync(out, { recursive: true, force: true })
}
