// Гейт корректности сливаемого текста (docs/05 §1.4, §3.10).
//
// Сценарии — из `baza/text/text.test.ts`, но ОЖИДАНИЯ проверены. Три из пяти
// переносятся с исправленным результатом, и каждый раз причина названа прямо в
// тесте: два фиксировали дефект (`offset_by_point` для несуществующей точки),
// один — следствие СВОЕГО устройства адресов, которое docs/05 §3.6 меняет
// сознательно.
//
// Доставка идёт через `packEncode`/`packDecode` и заново собранные юниты
// (docs/05 §8.1): `units_steal` из baza кладёт ТЕ ЖЕ JS-объекты в чужой индекс,
// и её 27 merge-сценариев слепы и к кодеку, и к идентичности после
// десериализации.

import { flush, watchEffect } from '@sync/fiber'
import { describe, expect, test } from 'vitest'
import type { Vary } from '../../binary/vary'
import type { Head } from '../index'
import type { Caret, Point } from '../index'
import { Paper } from './paper'
import { born, deliver, headAt, stand, sync, type Stand } from './shelf-stand'

/** Каретка найденной точки. Тест обязан упасть, если точка не нашлась. */
function caretOf(point: Point): Caret {
  if (!point.found) throw new Error(`point not found, remainder ${point.rest}`)
  return point.caret
}

/**
 * ПЕРЕЗАПИСАТЬ существующий узел от лица чужого пира.
 *
 * `tamper` из общего стенда кладёт НОВОГО ребёнка под голову, а здесь нужно
 * другое — тот же `self`, тот же `lead`, чужое значение: именно так выглядит
 * узел, приехавший от версии приложения, у которой в этом поле лежит не строка.
 * Перевод идёт через 48-битный id формата: номера узлов через ленды не
 * переносятся (ADR-016).
 */
function spoil(at: Stand, node: Head, value: Vary): void {
  const view = at.land.peek(node)
  if (view === null) throw new Error('no node')

  const other = stand(0x99, 9000)
  const head = other.land.nodeOf(at.land.idOf(view.head))
  const lead = other.land.nodeOf(at.land.idOf(view.lead))
  other.land.write(head, lead, other.land.nodeOf(at.land.idOf(node)), value, 'term')
  deliver(at, other)
}

describe('text: sequence edits (port of «Change sequences»)', () => {
  test('seven edits in a row yield the same tokens as baza', () => {
    const at = stand()
    const paper = at.space.root(Paper)

    // У baza тут `list.items_vary()` — тот же head, прочитанный как список.
    // У нас уровня два, поэтому прямые дети слота это АБЗАЦЫ, а токены даёт
    // `tokens()`: он и есть «второй уровень» из docs/05 §1.4.
    expect(paper.body()).toBe('')
    expect(paper.body.tokens()).toEqual([])

    paper.body('foo')
    expect(paper.body()).toBe('foo')
    expect(paper.body.tokens()).toEqual(['foo'])

    paper.body('foo bar')
    expect(paper.body()).toBe('foo bar')
    expect(paper.body.tokens()).toEqual(['foo', ' bar'])

    paper.body('foo lol bar')
    expect(paper.body()).toBe('foo lol bar')
    expect(paper.body.tokens()).toEqual(['foo', ' lol', ' bar'])

    paper.body('lol bar')
    expect(paper.body()).toBe('lol bar')
    expect(paper.body.tokens()).toEqual(['lol', ' bar'])

    paper.body('foo bar')
    expect(paper.body()).toBe('foo bar')
    expect(paper.body.tokens()).toEqual(['foo', ' bar'])

    paper.body('foo  bar')
    expect(paper.body()).toBe('foo  bar')
    expect(paper.body.tokens()).toEqual(['foo', ' ', ' bar'])

    paper.body('foo  BarBar')
    expect(paper.body()).toBe('foo  BarBar')
    expect(paper.body.tokens()).toEqual(['foo', ' ', ' Bar', 'Bar'])
  })

  test('editing one word out of ten births ONE unit', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз два три четыре пять шесть семь восемь девять десять')

    const units = born(at, () => {
      paper.body('раз два три четыре ПЯТЬ шесть семь восемь девять десять')
    })
    expect(units).toBe(1)
    expect(paper.body()).toBe('раз два три четыре ПЯТЬ шесть семь восемь девять десять')
  })
})

describe('text: offset ↔ caret at one level (port of «str: Offset <=> Point»)', () => {
  test('token bounds are inclusive, and a nonexistent point has no offset', () => {
    const at = stand()
    const paper = at.space.root(Paper)

    paper.body('fooBar')
    expect(paper.body.tokens()).toEqual(['foo', 'Bar'])

    const first = caretOf(paper.body.pointAt(0)).token
    const second = caretOf(paper.body.pointAt(4)).token
    expect(second).not.toBe(first)

    expect(paper.body.pointAt(0)).toEqual({ found: true, caret: { token: first, at: 0 } })
    expect(paper.body.offsetAt({ token: first, at: 0 })).toBe(0)

    // ГРАНИЦА ВКЛЮЧИТЕЛЬНА: позиция ровно на конце токена принадлежит ЕМУ.
    expect(paper.body.pointAt(3)).toEqual({ found: true, caret: { token: first, at: 3 } })
    expect(paper.body.offsetAt({ token: first, at: 3 })).toBe(3)

    expect(paper.body.pointAt(5)).toEqual({ found: true, caret: { token: second, at: 2 } })
    expect(paper.body.offsetAt({ token: second, at: 2 })).toBe(5)

    expect(paper.body.pointAt(6)).toEqual({ found: true, caret: { token: second, at: 3 } })
    expect(paper.body.offsetAt({ token: second, at: 3 })).toBe(6)

    // ИСПРАВЛЕННОЕ ОЖИДАНИЕ №1. baza: `offset_by_point([first, 5, 0])` = 5, то
    // есть каретка, стоящая за концом СВОЕГО токена, отдаёт смещение внутри
    // СОСЕДНЕГО. Каретка существует ровно затем, чтобы пережить чужую правку, и
    // укоротившийся токен не имеет права уводить курсор к соседу: прижимаем к
    // концу токена.
    expect(paper.body.offsetAt({ token: first, at: 5 })).toBe(3)

    // ИСПРАВЛЕННОЕ ОЖИДАНИЕ №2. baza: `point_by_offset(7)` = `['', 1, 0]`, и тот
    // же кортеж означал бы координату, будь голова непустой (реестр, п. 33);
    // `offset_by_point(['', 1, 0])` возвращал `['', 7]` — «смещение» точки,
    // которой в тексте нет. У нас `Point` размеченный, и `Caret` живёт ТОЛЬКО в
    // ветке `found`, поэтому вопрос «а какое смещение у ненайденной точки»
    // невыразим.
    expect(paper.body.pointAt(7)).toEqual({ found: false, rest: 1 })
  })

  test('a caret on a foreign node is `null`, not a made-up offset', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('fooBar')

    expect(paper.body.offsetAt({ token: headAt(at, 0x7f_0000), at: 1 })).toBe(null)
  })

  test('the caret survives an edit to its LEFT', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('foo bar baz')

    const caret = caretOf(paper.body.pointAt(9))
    expect(paper.body.offsetAt(caret)).toBe(9)

    // Дописали слово в начале: смещение каретки уехало, сама каретка цела.
    paper.body.write('XX', 0, 0)
    expect(paper.body()).toBe('XXfoo bar baz')
    expect(paper.body.offsetAt(caret)).toBe(11)
  })
})

describe('text: offset ↔ caret at two levels (port of «text: Offset <=> Point»)', () => {
  test('the descent goes through the paragraph, and the paragraph boundary belongs to its last token', () => {
    const at = stand()
    const paper = at.space.root(Paper)

    paper.body('foo bar\n666 777')
    expect(paper.body.paragraphs()).toEqual(['foo bar\n', '666 777'])
    expect(paper.body.tokens()).toEqual(['foo', ' bar', '\n', '666', ' 777'])

    const first = caretOf(paper.body.pointAt(0)).token
    expect(paper.body.pointAt(0)).toEqual({ found: true, caret: { token: first, at: 0 } })
    expect(paper.body.offsetAt({ token: first, at: 0 })).toBe(0)

    // Смещение 8 — конец первого абзаца. baza отдаёт третий токен ПЕРВОГО
    // абзаца со смещением 1, и это правильный ответ: граница включительна.
    const edge = caretOf(paper.body.pointAt(8))
    expect(edge.at).toBe(1)
    expect(paper.body.offsetAt(edge)).toBe(8)
    expect(edge.token).not.toBe(first)

    // За концом текста каретки нет — есть остаток.
    expect(paper.body.pointAt(16)).toEqual({ found: false, rest: 1 })
  })
})

describe('text: merging', () => {
  test('different sequences converge and lose none (port of «Merge different sequences»)', () => {
    // Часы обеих реплик стоят на одной секунде: LWW разводит их арбитром по
    // `peer`, и это самый интересный вход.
    const left = stand(0x11, 1000)
    const right = stand(0x22, 1000)

    left.space.root(Paper).body('foo bar.')
    right.space.root(Paper).body('xxx yyy.')

    sync(left, right)

    const one = left.space.root(Paper).body()
    const two = right.space.root(Paper).body()
    expect(one).toBe(two)

    // Оба текста целы; конкретный порядок задаёт НАШ арбитраж — `peer` по
    // байтам вверх (ADR-015), — а не порядок baza: у неё сравнение шло по
    // base64url, где цифры идут после букв (реестр, п. 19).
    expect(one).toBe('foo bar.xxx yyy.')
  })

  test('paragraphs of different replicas do not interleave word by word', () => {
    const left = stand(0x11, 1000)
    const right = stand(0x22, 1000)

    left.space.root(Paper).body('первая строка\n')
    right.space.root(Paper).body('вторая строка\n')

    sync(left, right)

    const text = left.space.root(Paper).body()
    expect(right.space.root(Paper).body()).toBe(text)
    // Каждая строка цела: адрес абзаца считается по ЕГО ТЕКСТУ, поэтому два
    // разных абзаца, вставленных в одну точку, остаются двумя узлами. Возьми
    // адрес от маркера — и токены обеих строк слились бы в один абзац.
    expect(left.space.root(Paper).body.paragraphs()).toEqual(['первая строка\n', 'вторая строка\n'])
  })

  test('identical inserts collapse, divergence is settled by LWW (port of «Merge same insertions»)', () => {
    const base = stand(0x11, 1000)
    base.space.root(Paper).body('( )')

    const left = stand(0x22, 2000)
    const right = stand(0x33, 2000)
    deliver(left, base)
    deliver(right, base)

    left.space.root(Paper).body('( [ f ] )')
    right.space.root(Paper).body('( [ f ] )')

    left.clock.advance(1)
    left.space.root(Paper).body('( [ foo ] )')
    right.clock.advance(2)
    right.space.root(Paper).body('( [ fu ] )')

    sync(left, right)

    const one = left.space.root(Paper).body()
    expect(right.space.root(Paper).body()).toBe(one)

    // ИСПРАВЛЕННОЕ ОЖИДАНИЕ №3. baza: `'( [ fu ] [ foo ] )'` — обе вставки
    // выживают целыми блоками, потому что `list.splice` брала `self` элемента
    // СЛУЧАЙНЫМ (`land.self_make()` без аргумента), и одинаковый набор токенов
    // у двух пиров давал два непересекающихся поддерева.
    //
    // У нас адрес элемента КОНТЕНТНЫЙ — H(соль ‖ head ‖ lead ‖ значение), и это
    // прямое требование docs/05 §3.6: «на ней держится схлопывание общего
    // префикса». Одинаковая вставка `'( [ f ] )'` даёт у обоих ОДНИ И ТЕ ЖЕ
    // юниты, поэтому дальше расходится ровно одно слово — и его судьбу решает
    // LWW, как и положено слову. Побеждает более поздняя правка.
    expect(one).toBe('( [ fu ] )')
  })

  test('redelivery changes nothing', () => {
    const left = stand(0x11, 1000)
    const right = stand(0x22, 1000)
    left.space.root(Paper).body('раз два\nтри четыре')
    sync(left, right)

    const before = right.land.size()
    deliver(right, left)
    deliver(right, left)
    expect(right.land.size()).toBe(before)
    expect(right.space.root(Paper).body()).toBe('раз два\nтри четыре')
  })
})

describe('text: range edits', () => {
  test('inserting a letter at the end of a word does not multiply tokens', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('foo bar')

    // Без приклеивания ЛЕВОГО соседа перед перетокенизацией вышло бы
    // ['foo', '!', ' bar'] — текст выродился бы в посимвольное хранение.
    const units = born(at, () => paper.body.write('!', 3, 3))
    expect(paper.body()).toBe('foo! bar')
    expect(paper.body.tokens()).toEqual(['foo', '!', ' bar'])
    expect(units).toBe(1)
  })

  test('insert at the end of text', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('foo')

    const units = born(at, () => paper.body.write('!', 3, 3))
    expect(paper.body()).toBe('foo!')
    expect(units).toBe(1)
  })

  test('range deletion', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('foo bar baz')

    paper.body.write('', 0, 4)
    expect(paper.body()).toBe('bar baz')
  })

  test('range replacement inside a word', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('привет мир')

    paper.body.write('ЕТ', 4, 6)
    expect(paper.body()).toBe('привЕТ мир')
  })

  test('an edit touching a newline rebuilds the split', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз\nдва')

    // Стёрли `\n`: два абзаца обязаны стать одним.
    paper.body.write('', 3, 4)
    expect(paper.body()).toBe('раздва')
    expect(paper.body.paragraphs()).toEqual(['раздва'])
  })

  test('inserting a newline splits the paragraph', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раздва')

    paper.body.write('\n', 3, 3)
    expect(paper.body()).toBe('раз\nдва')
    expect(paper.body.paragraphs()).toEqual(['раз\n', 'два'])
  })

  test('a write at the start of a line goes into ITS OWN line, not the tail of the previous one', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз\nдва')

    // Смещение 4 — начало второй строки. Отдай его первому абзацу — и правка
    // каждый раз пересобирала бы разбиение общим путём.
    const units = born(at, () => paper.body.write('X', 4, 4))
    expect(paper.body()).toBe('раз\nXдва')
    expect(paper.body.paragraphs()).toEqual(['раз\n', 'Xдва'])
    expect(units).toBe(1)
  })

  test('appending after the last newline starts a new paragraph', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз\n')

    // Смещение 4 — конец текста, и он же конец абзаца, который кончается `\n`.
    // Отдай его первому абзацу — и текст стал бы 'раз\nX' внутри ОДНОГО абзаца,
    // то есть разбиение разошлось бы с содержимым.
    paper.body.write('X', 4, 4)
    expect(paper.body()).toBe('раз\nX')
    expect(paper.body.paragraphs()).toEqual(['раз\n', 'X'])
  })

  test('an edit exactly on the paragraph boundary goes into the second one', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('аа\nбб\nвв')

    // Три границы подряд, каждая — конец абзаца с `\n`.
    paper.body.write('1', 3, 3)
    expect(paper.body()).toBe('аа\n1бб\nвв')
    paper.body.write('2', 7, 7)
    expect(paper.body()).toBe('аа\n1бб\n2вв')
    expect(paper.body.paragraphs()).toEqual(['аа\n', '1бб\n', '2вв'])
  })

  test('offsets past the end of text do not throw', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз')

    paper.body.write('!', 100, 200)
    expect(paper.body()).toBe('раз!')

    paper.body.write('?', -5, -1)
    expect(paper.body()).toBe('?раз!')
  })

  test('editing an empty field creates text instead of crashing', () => {
    const at = stand()
    const paper = at.space.root(Paper)

    paper.body.write('свежий', 0, 0)
    expect(paper.body()).toBe('свежий')
  })

  test('an empty edit of an empty field births not a single unit', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    expect(born(at, () => paper.body.write('', 0, 0))).toBe(0)
  })
})

describe('text: granularity', () => {
  test('editing one paragraph does not touch the units and nodes of the others', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('ааа\nббб\nввв')

    // Каретка в ТРЕТЬЕМ абзаце: если его перепишут, узел сменится.
    const third = caretOf(paper.body.pointAt(9)).token

    // Буква СТРОЧНАЯ намеренно: заглавная — граница токена (CamelCase, инвариант
    // токенизатора), и «одна буква» честно стоила бы двух юнитов.
    const units = born(at, () => paper.body.write('х', 1, 1))
    expect(paper.body()).toBe('ахаа\nббб\nввв')
    expect(units).toBe(1)
    expect(caretOf(paper.body.pointAt(10)).token).toBe(third)
  })

  test('a NEIGHBORING field appearing does not recompute the text (decision R3)', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз два')

    let runs = 0
    const stop = watchEffect(() => {
      runs += 1
      paper.body()
    })
    flush()
    expect(runs).toBe(1)

    // Первая запись в соседнее поле меняет СОСТАВ ДЕТЕЙ документа: `slot`
    // текста пересчитается, вернёт ту же голову, и `Fiber.put` погасит
    // распространение — значение не декодируется вовсе.
    paper.title('заголовок')
    paper.note('другой текст')
    flush()
    expect(runs).toBe(1)

    stop()
  })

  test('two text fields of one document are independent', () => {
    const at = stand()
    const paper = at.space.root(Paper)

    paper.body('первый')
    paper.note('второй')
    expect(paper.body()).toBe('первый')
    expect(paper.note()).toBe('второй')

    paper.body('первый другой')
    expect(paper.note()).toBe('второй')
  })
})

describe('text: idempotence', () => {
  test('`body(body())` births not a single unit', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз два\nтри четыре')

    expect(born(at, () => paper.body(paper.body()))).toBe(0)
    expect(born(at, () => paper.body(paper.body()))).toBe(0)
  })

  test('rewriting the same value is zero units', () => {
    const at = stand()
    const paper = at.space.root(Paper)

    const first = born(at, () => paper.body('раз два'))
    expect(first).toBeGreaterThan(0)
    expect(born(at, () => paper.body('раз два'))).toBe(0)
  })

  test('a write returns the LWW winner, not what was written', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    expect(paper.body('раз два')).toBe('раз два')
    expect(paper.body.set('три')).toBe('три')
  })
})

describe('text: reads NEVER throw', () => {
  test('a number instead of a token yields a skip and one Issue, not an exception', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз два')

    const token = caretOf(paper.body.pointAt(0)).token
    at.issues.length = 0
    spoil(at, token, 42)

    expect(() => paper.body()).not.toThrow()
    expect(paper.body()).toBe(' два')
    expect(at.issues.length).toBeGreaterThan(0)
    const issue = at.issues[0]!
    expect(issue.kind).toBe('decode')
    expect(issue.field).toBe('body')
    expect(issue.expected).toBe('string')
    expect(issue.got).toContain('number')
    expect(issue.peer).not.toBe(null)
  })

  test('garbage breaks neither caret, nor tokens, nor paragraphs', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз два\nтри')

    const token = caretOf(paper.body.pointAt(0)).token
    spoil(at, token, { нет: 'такого' })

    expect(() => paper.body.tokens()).not.toThrow()
    expect(() => paper.body.paragraphs()).not.toThrow()
    expect(() => paper.body.pointAt(3)).not.toThrow()
    expect(paper.body.tokens()).toEqual(['', ' два', '\n', 'три'])
  })
})

describe('text: format bounds', () => {
  test('a word longer than a unit writes and reads whole', () => {
    const at = stand()
    const paper = at.space.root(Paper)

    // 200 знаков одним словом: в юнит влезает 62 байта (docs/03 §2), поэтому
    // без нарезки ленд отверг бы запись броском — и ввод пользователя пропал бы.
    const word = 'abcdefghij'.repeat(20)
    expect(() => paper.body(word)).not.toThrow()
    expect(paper.body()).toBe(word)
    expect(paper.body.tokens().length).toBeGreaterThan(1)
  })

  test('an edit inside an emoji does not cut a surrogate pair', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('a😀b')

    // Смещение 2 приходится на середину пары: разрез дал бы одинокий суррогат,
    // а на нём бросает кодек `vary`.
    expect(() => paper.body.write('X', 2, 2)).not.toThrow()
    expect(paper.body()).toBe('aX😀b')
  })

  test('a compound emoji stays one token in the land too', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('привет 👩🏿‍🤝‍🧑🏿 мир')
    expect(paper.body()).toBe('привет 👩🏿‍🤝‍🧑🏿 мир')
    expect(paper.body.tokens()).toContain('👩🏿‍🤝‍🧑🏿')
  })
})

describe('text: length, paragraphs, erasure', () => {
  test('size matches the string length', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    expect(paper.body.size()).toBe(0)
    paper.body('раз\nдва')
    expect(paper.body.size()).toBe(7)
  })

  test('paragraphs of an empty field is empty, not one empty paragraph', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    expect(paper.body.paragraphs()).toEqual([])
    expect(paper.body.tokens()).toEqual([])
  })

  test('clear erases the text with tombstones on paragraphs', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз\nдва\nтри')

    // Три абзаца — три надгробия, а не юнит на каждое слово.
    const units = born(at, () => paper.body.clear())
    expect(units).toBe(3)
    expect(paper.body()).toBe('')
    expect(paper.body.paragraphs()).toEqual([])
  })

  test('writing an empty string erases the same as clear', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    paper.body('раз\nдва')
    paper.body('')
    expect(paper.body()).toBe('')
  })

  test('clear of an empty field births no units', () => {
    const at = stand()
    const paper = at.space.root(Paper)
    expect(born(at, () => paper.body.clear())).toBe(0)
  })
})

describe('text: the 100 KB insert budget', () => {
  test('inserting one character costs at most three units', () => {
    const at = stand()
    const paper = at.space.root(Paper)

    // 100 КБ настоящим текстом: 1250 абзацев по 80 знаков.
    const line = 'десять слов подряд чтобы вышло восемьдесят знаков ровно и ещё немного текста\n'
    const text = line.repeat(Math.ceil(100_000 / line.length))
    paper.body(text)
    expect(paper.body.size()).toBe(text.length)

    const at40 = Math.floor(text.length / 2)
    const units = born(at, () => paper.body.write('!', at40, at40))
    // Бюджет docs/05 §8.5: ≤ 3 юнита. Время — в `bench/text.mjs`.
    expect(units).toBeLessThanOrEqual(3)
    expect(paper.body.size()).toBe(text.length + 1)
  })
})
