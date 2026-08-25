// ─── Сливаемый текст: два уровня — абзацы, внутри токены ─────────────────────
//
// docs/05 §1.4 и §3.10. Уровней ровно два, и оба нужны:
//
//   слот поля (`vals`)
//     ├── абзац (`vals`, значение — маркер) ── токен (`term`) ── токен ── …
//     └── абзац ─────────────────────────────  токен ── …
//
// ПОЧЕМУ АБЗАЦЫ. Правка одного абзаца не создаёт ни одного юнита в остальных —
// это первое. Второе важнее и видно только на масштабе: без уровня абзацев
// вставка буквы в текст на 100 КБ обязана прочитать ВСЕ его токены (порядка
// 18 000), а `order()` стоит ≈109 нс на ребёнка (замер S3) — 2 мс только на
// раскладку, при бюджете 1 мс на всю вставку. С абзацами кэш длины живёт на
// абзаце: правка одного гасит один кэш из тысячи, а поиск нужного абзаца — это
// тысяча ЧТЕНИЙ ГОТОВОГО ЧИСЛА.
//
// ПОЧЕМУ ДИСПЕТЧЕРИЗАЦИЯ ПО `tag` ЗДЕСЬ ЗАКОННА. docs/05 §3.9 запрещает делать
// `tag` дискриминатором — но запрет про ВИД ПОЛЯ: атом обязан читаться со слота
// с любым тегом, иначе `cast` между видами перестаёт работать. Внутри поддерева
// текста вопрос другой — «этот узел контейнер или лист», — и `tag` отвечает на
// него, не решая ничего про вид. Ровно это и написано в §3.10: «`str()`
// рекурсивен: `term` — декодировать, иначе спуститься».

import { computed, untracked, type KeyedComputedRef } from '@sync/fiber'
import { Link } from '../binary/link'
import { ROOT, type SandView } from '../land/view'
import { predictItem } from './address'
import { type Caret, type Handle, type Head, type Point, SPOT } from './channel'
import { type Cell, cellOf, mountSlot } from './cell'
import { describe } from './issue'
// Реконсиляция токенов — ОБЩАЯ с `list`, а не своя копия. Алгоритм один
// (docs/05 §3.8), и две его реализации рано или поздно разойдутся в порядке
// ветвей — а порядок ветвей и есть то, на чём висят 14 сценариев конкурентного
// слияния. Заодно это делает буквальной правду из §3.9: текст и список — два
// ВИДА на одни юниты, и правка через любой из них идёт одним кодом.
import { reconcile } from './list'
import type { SpaceCore } from './space'
import { fitTokens, single, splitParagraphs, tokenize } from './tokens'

/**
 * Значение юнита абзаца.
 *
 * Маркер, а не текст абзаца: в юнит влезает 62 байта (docs/03 §2), и абзац туда
 * не помещается. Сам ТЕКСТ при этом всё равно участвует — но в адресе, см.
 * {@link bornPara}.
 */
const PARA = 'p'

const NO_WORDS: readonly string[] = Object.freeze([])

const NOT_FOUND_AT_ZERO: Point = Object.freeze({ found: false, rest: 0 })

/**
 * Кэши поля-текста: три канала на (модель × поле × ленд), ключ — узел.
 *
 * ЭТО ПРОДОЛЖЕНИЕ РЕШЕНИЯ Р2, а не второй кэш рядом с ним. `cell.value`
 * замемоизирован по ГОЛОВЕ ДОКУМЕНТА и потому не умеет отвечать «что в третьем
 * абзаце»; эти каналы замемоизированы по УЗЛУ-КОНТЕЙНЕРУ, и потому правка
 * одного абзаца гасит ровно один их ключ. Оба живут в описании поля, не в
 * сущности: непрочитанный текст не стоит ничего, прочитанный у 10 000
 * документов — записи в трёх Map, а не 30 000 файберов.
 */
interface Aid {
  /** Узел → текст его поддерева. `str(слот)` — весь текст, `str(абзац)` — абзац. */
  str: KeyedComputedRef<Head, string>
  /** Узел → плоский список токенов поддерева (`tokens()` из docs/05 §1.4). */
  words: KeyedComputedRef<Head, readonly string[]>
  /** Узел → тексты его ПРЯМЫХ детей, то есть абзацы. */
  paras: KeyedComputedRef<Head, readonly string[]>
}

/**
 * Кэши по ячейке.
 *
 * `WeakMap`, а не поле ячейки: форма `Cell` — общая для всех девяти видов
 * (правило 1 горячего пути), и дописать в неё слот ради одного вида значило бы
 * дать `cell.field.kind` два шейпа на общем пути. `WeakMap.get` здесь не в
 * тёплом чтении: оно идёт через `cell.value`, то есть через кэш файбера, и
 * сюда не заходит вовсе.
 */
const AIDS = new WeakMap<Cell, Aid>()

function aidOf(core: SpaceCore, cell: Cell): Aid {
  const found = AIDS.get(cell)
  if (found !== undefined) return found

  const fresh = makeAid(core, cell)
  AIDS.set(cell, fresh)
  return fresh
}

function makeAid(core: SpaceCore, cell: Cell): Aid {
  // Все три слота объявлены сразу и заполняются ниже: каналы замкнуты друг на
  // друга (`paras` зовёт `str`, `str` и `words` спускаются в себя), а шейп при
  // этом не меняется — меняется содержимое, и ровно один раз на (модель, поле).
  const aid: Aid = {
    str: undefined as unknown as KeyedComputedRef<Head, string>,
    words: undefined as unknown as KeyedComputedRef<Head, readonly string[]>,
    paras: undefined as unknown as KeyedComputedRef<Head, readonly string[]>,
  }

  aid.str = computed.keyed((node: Head): string => {
    const kids = core.order(node)
    let out = ''
    for (let i = 0; i < kids.length; i++) {
      const view = kids[i] as SandView
      out += view.tag === 'term' ? termOf(core, cell, view) : aid.str(view.self)
    }
    return out
  })

  aid.words = computed.keyed((node: Head): readonly string[] => {
    const kids = core.order(node)
    if (kids.length === 0) return NO_WORDS

    const out: string[] = []
    for (let i = 0; i < kids.length; i++) {
      const view = kids[i] as SandView
      if (view.tag === 'term') {
        out.push(termOf(core, cell, view))
        continue
      }
      const inner = aid.words(view.self)
      for (let j = 0; j < inner.length; j++) out.push(inner[j] as string)
    }
    return out
  })

  aid.paras = computed.keyed((node: Head): readonly string[] => {
    const kids = core.order(node)
    if (kids.length === 0) return NO_WORDS

    const out: string[] = []
    for (let i = 0; i < kids.length; i++) out.push(textOf(core, cell, aid, kids[i] as SandView))
    return out
  })

  return aid
}

/**
 * Значение терма строкой. НИКОГДА не бросает (docs/05 §4).
 *
 * Мусор от узла другой версии — это `blank` строки плюс ровно один `Issue`:
 * один недобросовестный пир не имеет права уронить редактор. `Issue.head` тут
 * узел-КОНТЕЙНЕР (абзац или слот поля), а не документ: каналы кэшей
 * мультиплексированы по контейнеру и о документе не знают, а адрес всё равно
 * полон — `land` плюс `self` называют юнит однозначно.
 */
function termOf(core: SpaceCore, cell: Cell, view: SandView): string {
  const raw = core.valueOf(view)
  if (typeof raw === 'string') return raw

  const unreadable = raw === null && core.broken(view)
  core.report({
    kind: unreadable ? 'shape' : 'decode',
    land: core.id,
    head: view.head,
    self: view.self,
    peer: Link.peer(view.peer),
    field: cell.key,
    expected: 'string',
    got: unreadable ? 'bytes the codec does not know' : describe(raw),
  })
  return ''
}

/** Текст узла: терм — своё значение, контейнер — своё поддерево. */
function textOf(core: SpaceCore, cell: Cell, aid: Aid, view: SandView): string {
  return view.tag === 'term' ? termOf(core, cell, view) : aid.str(view.self)
}

// ── Чтение ───────────────────────────────────────────────────────────────────

/** Весь текст поля. Читается С ПОДПИСКОЙ — на слот и на каждый абзац. */
export function readText(core: SpaceCore, cell: Cell, head: Head): unknown {
  const slot = cell.slot(head)
  if (slot === ROOT) return ''
  return aidOf(core, cell).str(slot)
}

// ── Запись целиком ───────────────────────────────────────────────────────────

/**
 * `body(next)` — реконсиляция АБЗАЦЕВ.
 *
 * Сравнение идёт по тексту существующего абзаца, поэтому совпавший абзац не
 * трогается вовсе, а изменившийся сохраняет свой узел и правит только токены.
 */
export function writeText(core: SpaceCore, cell: Cell, head: Head, next: unknown): void {
  // ОДНА обёртка на всю операцию, а не по одной на чтение.
  //
  // `untracked` обязателен везде, где запись читает: подписать пишущего на то,
  // что он сам меняет, значит разбудить его собственной правкой. Но обёртка на
  // КАЖДОЕ чтение — это замыкание на КАЖДЫЙ абзац: на корпусе бенча (1458
  // абзацев) поиск границ делает два прохода, то есть 2916 аллокаций на одну
  // вставку буквы. Довод механический, а не замеренный: размах `text/insert-100k`
  // на этом стенде ×1.5 (112–173 мкс при бюджете 1 мс), и отдельным числом такая
  // экономия из него не выделяется — но 2916 лишних замыканий на правку буквы не
  // нужны и без числа.
  untracked(() => writeAll(core, cell, head, next as string))
}

function writeAll(core: SpaceCore, cell: Cell, head: Head, next: string): void {
  const lines = splitParagraphs(next)

  let slot = cell.slot(head)
  if (slot === ROOT) {
    // Стирать нечего: ключевой юнит поверх пустоты — юнит, который ничего не
    // меняет, зато навсегда уезжает по проводу.
    if (lines.length === 0) return
    slot = mountSlot(core, head, cell.key, cell.field)
  }

  const aid = aidOf(core, cell)
  const prev = core.order(slot)

  // ПОРЯДОК ВЕТВЕЙ ФИКСИРОВАН (docs/05 §3.8): совпало → вставка → удаление →
  // замена. Смена приоритета превращает «поправил один абзац» в N юнитов и
  // роняет вложенные поддеревья.
  let lead: Head = ROOT
  let i = 0
  let j = 0
  const to = prev.length

  while (j < lines.length || i < to) {
    const before = prev[i] as SandView | undefined
    const after = lines[j] as string | undefined

    if (before !== undefined && after !== undefined && textOf(core, cell, aid, before) === after) {
      lead = before.self
      i += 1
      j += 1
      continue
    }
    if (after !== undefined && lines.length - j > to - i) {
      lead = bornPara(core, slot, lead, after)
      j += 1
      continue
    }
    if (before !== undefined && to - i > lines.length - j) {
      // Надгробие остаётся ЯКОРЕМ: `order()` спускается в детей мёртвых узлов,
      // поэтому позиция вставки переживает удаление. Свой `lead` надгробие
      // сохраняет — переезд утащил бы за собой всё поддерево (это делает
      // `Land.remove`).
      core.remove(before.self)
      lead = before.self
      i += 1
      continue
    }

    // Замена — ТОТ ЖЕ узел абзаца, правятся только его токены. Именно поэтому
    // правка строки не роняет ни каретки соседей, ни их юниты.
    const view = before as SandView
    // Перепривязка только если якорь и правда сместился (вставка или удаление
    // выше по тексту) или узел ещё не контейнер: безусловный `post` стоил бы
    // юнита на КАЖДЫЙ изменённый абзац поверх юнитов самой правки.
    if (view.lead !== lead || view.tag !== 'vals') core.post(slot, lead, view.self, PARA, 'vals')
    fillPara(core, view.self, after as string)
    lead = view.self
    i += 1
    j += 1
  }
}

/**
 * Новый абзац.
 *
 * АДРЕС КОНТЕНТНЫЙ И СЧИТАЕТСЯ ПО ТЕКСТУ АБЗАЦА, хотя в юните лежит маркер.
 * Формула `predictItem` из docs/05 §3.6 зависит от точки вставки и значения;
 * подставь сюда маркер — и два РАЗНЫХ абзаца, набранных двумя пирами в одной
 * точке, получили бы ОДИН узел, а их токены переплелись бы внутри него, съев
 * набранный пользователем перевод строки. По тексту: одинаковые абзацы
 * схлопываются (то самое «схлопывание общего префикса» из §3.6), разные
 * остаются двумя.
 */
function bornPara(core: SpaceCore, slot: Head, lead: Head, line: string): Head {
  const self = predictItem(core.land, core.salt, slot, lead, line)
  core.post(slot, lead, self, PARA, 'vals')
  fillPara(core, self, line)
  return self
}

/** Переписать токены абзаца целиком — реконсиляцией, а не перезаписью. */
function fillPara(core: SpaceCore, para: Head, line: string): void {
  const prev = core.order(para)
  reconcile(core, para, prev, fitTokens(tokenize(line)), 0, prev.length)
}

// ── Правка диапазона ─────────────────────────────────────────────────────────

/** Где смещение внутри списка абзацев. */
interface Spot2 {
  readonly index: number
  readonly off: number
}

/**
 * `write(next, from, to)` — вставка/замена/удаление по смещениям.
 *
 * Быстрый путь (и единственный, про который написан бюджет `text/insert-100k`):
 * правка не выходит за один абзац и не задевает перевод строки — тогда
 * перетокенизируется ОДИН абзац, а остальные не читаются даже на длину.
 * Всё прочее уходит общим путём через {@link writeAll}: дороже, но всё ещё
 * минимально на своём уровне.
 */
function writeRange(core: SpaceCore, cell: Cell, head: Head, next: string, from: number, to: number): void {
  const lo = from < 0 ? 0 : from
  const hi = to < lo ? lo : to

  let slot = cell.slot(head)
  if (slot === ROOT) {
    if (next === '') return
    slot = mountSlot(core, head, cell.key, cell.field)
  }

  const aid = aidOf(core, cell)
  const paras = core.order(slot)

  if (paras.length > 0) {
    const a = locate(core, cell, aid, paras, lo)
    if (a.index < paras.length) {
      const b = locate(core, cell, aid, paras, hi)
      if (b.index === a.index) {
        const view = paras[a.index] as SandView
        const line = textOf(core, cell, aid, view)
        const at = snap(line, a.off)
        const till = snap(line, b.off)
        // Абзац обязан ОСТАТЬСЯ одним абзацем: правка, задевшая перевод строки,
        // меняет разбиение, и чинить его на месте пришлось бы тем же общим
        // путём — только вручную и с шансом ошибиться.
        if (view.tag === 'vals' && single(line.slice(0, at) + next + line.slice(till))) {
          patchPara(core, cell, aid, view.self, next, at, till)
          return
        }
      }
    }
  }

  const whole = aid.str(slot)
  const cutFrom = snap(whole, lo > whole.length ? whole.length : lo)
  const cutTo = snap(whole, hi > whole.length ? whole.length : hi)
  writeAll(core, cell, head, whole.slice(0, cutFrom) + next + whole.slice(cutTo))
}

/**
 * Абзац, которому принадлежит смещение, и смещение внутри него.
 *
 * ГРАНИЦА ЗДЕСЬ НЕ ТА, ЧТО У КАРЕТКИ, и это сознательно. Смещение ровно на
 * конце абзаца, который заканчивается переводом строки, отдаётся СЛЕДУЮЩЕМУ
 * абзацу: набор в начале строки — самый частый ввод, и отдать его предыдущему
 * абзацу значило бы дописать текст ПОСЛЕ `\n`, то есть каждый раз пересобирать
 * разбиение общим путём. У каретки правило обратное (`off <= len`, §3.10) — там
 * важно не «куда писать», а «за каким токеном стоять», и корпус baza это
 * фиксирует.
 */
function locate(core: SpaceCore, cell: Cell, aid: Aid, paras: readonly SandView[], mark: number): Spot2 {
  let off = mark
  for (let i = 0; i < paras.length; i++) {
    const view = paras[i] as SandView
    const line = textOf(core, cell, aid, view)
    const len = line.length
    if (off < len) return { index: i, off }
    if (off === len && !(i + 1 < paras.length && line.charCodeAt(len - 1) === 10)) return { index: i, off }
    off -= len
  }
  return { index: paras.length, off }
}

/**
 * Правка внутри одного абзаца.
 *
 * `at`/`till` — смещения ВНУТРИ абзаца. Порт `write` из baza с исправлением:
 * там левая и правая границы искались одним двухсчётчиковым циклом, который
 * мутировал сами аргументы и на пустом абзаце уходил в `list.length`; здесь два
 * независимых поиска и явные срезы.
 */
function patchPara(
  core: SpaceCore,
  cell: Cell,
  aid: Aid,
  para: Head,
  next: string,
  at: number,
  till: number,
): void {
  const views = untracked(() => core.order(para))
  const words: string[] = []
  for (let i = 0; i < views.length; i++) words.push(untracked(() => textOf(core, cell, aid, views[i] as SandView)))

  const a = seek(words, at)
  const b = seek(words, till)

  let lo = a.index
  const hi = b.index < words.length ? b.index + 1 : words.length
  let patch = (a.index < words.length ? (words[a.index] as string).slice(0, a.off) : '')
    + next
    + (b.index < words.length ? (words[b.index] as string).slice(b.off) : '')

  // Приклеиваем ЛЕВОГО соседа перед перетокенизацией: без этого `'foo'` + `'!'`
  // дало бы `['foo', '!']` вместо `['foo!']`, текст выродился бы в посимвольное
  // хранение, и обещание «на порядок меньше юнитов» рухнуло бы.
  if (lo > 0 && lo === words.length) {
    lo -= 1
    patch = (words[lo] as string) + patch
  }

  reconcile(core, para, views, fitTokens(tokenize(patch)), lo, hi)
}

/**
 * Токен, которому принадлежит смещение.
 *
 * ГРАНИЦА ВКЛЮЧИТЕЛЬНА (`off <= len`): позиция ровно на конце токена
 * принадлежит ЭТОМУ токену. Сдвиг на единицу не ловится ни одним merge-тестом и
 * проявляется как прыжок курсора через слово при слиянии (docs/05 §3.10).
 */
function seek(words: readonly string[], mark: number): Spot2 {
  let off = mark
  for (let i = 0; i < words.length; i++) {
    const len = (words[i] as string).length
    if (off <= len) return { index: i, off }
    off -= len
  }
  return { index: words.length, off }
}

/**
 * Не резать суррогатную пару.
 *
 * Смещения приходят от прикладного кода, а он вправе передать любое число.
 * Разрез пары даёт одинокий суррогат, а на нём бросает кодек `vary` — то есть
 * правка текста падала бы из-за одного эмодзи.
 */
function snap(text: string, at: number): number {
  if (at <= 0) return 0
  if (at >= text.length) return text.length
  const high = text.charCodeAt(at - 1)
  if (high < 0xd800 || high > 0xdbff) return at
  const low = text.charCodeAt(at)
  return low >= 0xdc00 && low <= 0xdfff ? at - 1 : at
}

// ── Каретка ──────────────────────────────────────────────────────────────────

/**
 * Смещение → каретка. Обычное ЧТЕНИЕ, а не действие.
 *
 * У baza `point_by_offset` помечен `@$mol_action`, из-за чего подписка на текст
 * не возникала вовсе, и авторы дописывали её вручную строкой `this.text() //
 * track text to recalc selection`. Строки «ручная подписка, чтобы отследить
 * зависимость» здесь быть не может: если она понадобилась, значит граф не видит
 * настоящую зависимость.
 *
 * Подписка при этом МИНИМАЛЬНА: обход останавливается на найденном абзаце,
 * поэтому правка текста НИЖЕ каретки её не пересчитывает.
 */
function pointIn(core: SpaceCore, cell: Cell, aid: Aid, node: Head, from: number): Point {
  const kids = core.order(node)
  let off = from

  for (let i = 0; i < kids.length; i++) {
    const view = kids[i] as SandView
    if (view.tag === 'term') {
      const len = termOf(core, cell, view).length
      if (off <= len) return { found: true, caret: { token: view.self, at: off } }
      off -= len
      continue
    }

    // Длина берётся из КЭША абзаца: спускаться в чужой абзац ради его длины
    // значило бы читать весь документ на каждое движение курсора.
    const len = aid.str(view.self).length
    if (off > len) {
      off -= len
      continue
    }
    const found = pointIn(core, cell, aid, view.self, off)
    if (found.found) return found
    off = found.rest
  }

  return off === 0 ? NOT_FOUND_AT_ZERO : { found: false, rest: off }
}

/**
 * Каретка → смещение. `null` — токена в тексте нет.
 *
 * РАСХОЖДЕНИЕ С baza, где не найденная точка возвращала `['', offset]`, то есть
 * ТО ЖЕ кортежное значение, что и найденная координата, только с пустой головой
 * (реестр, п. 33). `text.test.ts` фиксировал это эталоном:
 * `offset_by_point(['',1,0])` = `['', 7]` — «смещение 7» для точки, которой в
 * тексте нет. У нас у не найденной каретки нет представления вовсе: `Point` —
 * размеченное объединение, `Caret` живёт только в его ветке `found`, а
 * `offsetAt` возвращает `null`.
 */
function offsetIn(core: SpaceCore, cell: Cell, aid: Aid, node: Head, caret: Caret, base: number): number | null {
  const kids = core.order(node)
  let at = base

  for (let i = 0; i < kids.length; i++) {
    const view = kids[i] as SandView
    const text = textOf(core, cell, aid, view)

    if (view.self === caret.token) {
      // Каретка ПЕРЕЖИВАЕТ чужие правки — в этом весь её смысл. Токен под ней
      // мог укоротиться, и тогда `caret.at` больше его длины: вернуть `at +
      // caret.at` значило бы поставить курсор внутрь СОСЕДА. Прижимаем к концу.
      const inside = caret.at < 0 ? 0 : caret.at > text.length ? text.length : caret.at
      return at + inside
    }

    if (view.tag !== 'term') {
      const found = offsetIn(core, cell, aid, view.self, caret, at)
      if (found !== null) return found
    }
    at += text.length
  }

  return null
}

// ── Таблица методов ──────────────────────────────────────────────────────────

/**
 * Методы канала текста: ОДНА таблица на (модель, поле).
 *
 * Приёмник определяется вызовом (`this`), поэтому ни одного нового замыкания на
 * канал — решение Р4. Прикладной код пишет `post.body.write('!', 14, 14)` и не
 * видит ни `this`, ни классов: ограничение 1 запрещает их ПРИКЛАДНИКУ, а не
 * реализации.
 */
export const TEXT_METHODS: Readonly<Record<string, unknown>> = Object.freeze({
  /** Явная запись. Возвращает победителя LWW, а не то, что записали. */
  set(this: Handle, next: string): string {
    const cell = cellOf(this)
    return cell.value(this[SPOT].head, next) as string
  },

  /**
   * Длина в кодовых единицах — той же мерой, что смещения `write` и `pointAt`.
   *
   * `size`, а не `length`: см. `channel.ts`. У функции собственное `length`
   * НЕПЕРЕЗАПИСЫВАЕМО, и `Object.assign` таблицы методов на канал бросил бы
   * прямо при открытии документа.
   */
  size(this: Handle): number {
    const cell = cellOf(this)
    return (cell.value(this[SPOT].head) as string).length
  },

  /** Первый уровень: абзацы. Перевод строки принадлежит своему абзацу. */
  paragraphs(this: Handle): readonly string[] {
    const cell = cellOf(this)
    const slot = cell.slot(this[SPOT].head)
    if (slot === ROOT) return NO_WORDS
    return aidOf(cell.core, cell).paras(slot)
  },

  /** Второй уровень: токены «разделитель + слово», плоско по всему тексту. */
  tokens(this: Handle): readonly string[] {
    const cell = cellOf(this)
    const slot = cell.slot(this[SPOT].head)
    if (slot === ROOT) return NO_WORDS
    return aidOf(cell.core, cell).words(slot)
  },

  /** Правка диапазона `[from, to)`. Пустой `next` — удаление. */
  write(this: Handle, next: string, from: number, to: number): void {
    const cell = cellOf(this)
    untracked(() => writeRange(cell.core, cell, this[SPOT].head, next, from, to))
  },

  pointAt(this: Handle, offset: number): Point {
    const cell = cellOf(this)
    const slot = cell.slot(this[SPOT].head)
    if (slot === ROOT) return offset === 0 ? NOT_FOUND_AT_ZERO : { found: false, rest: offset }
    return pointIn(cell.core, cell, aidOf(cell.core, cell), slot, offset)
  },

  offsetAt(this: Handle, caret: Caret): number | null {
    const cell = cellOf(this)
    const slot = cell.slot(this[SPOT].head)
    if (slot === ROOT) return null
    return offsetIn(cell.core, cell, aidOf(cell.core, cell), slot, caret, 0)
  },

  /**
   * Стереть текст: надгробие на каждый абзац.
   *
   * Токены внутри не трогаются намеренно — мёртвый абзац и так уходит из
   * `order()` вместе со всем поддеревом, а надгробие на каждое слово стоило бы
   * тысяч юнитов на провод ради того же наблюдаемого результата.
   */
  clear(this: Handle): void {
    const cell = cellOf(this)
    const core = cell.core
    untracked(() => {
      const slot = cell.slot(this[SPOT].head)
      if (slot === ROOT) return

      const kids = core.order(slot)
      for (let i = 0; i < kids.length; i++) core.remove((kids[i] as SandView).self)
    })
  },
})
