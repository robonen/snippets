// v8:hot — вызывается на каждом пересчёте узла
/**
 * Структурное сравнение значений.
 *
 * Нужно, чтобы пересчёт, давший **равное** значение, не будил подписчиков. Без него
 * любая пересборка массива или объекта в теле вычисления поднимала бы всё дерево
 * над ним: `[...items]` — уже новая ссылка, хотя содержимое то же.
 *
 * Порт идеи `$mol_compare_deep`. Проверяется тестами `Skip recalculation` и
 * `Dupes: Equality` из корпуса `$mol` — оба падали до появления этой функции.
 *
 * **Ложноотрицательный ответ безопасен**, ложноположительный — нет: сказать «разные»
 * про равные значит лишний раз пересчитать, сказать «равные» про разные значит
 * потерять обновление. Поэтому всё сомнительное — глубокая вложенность, объекты с
 * собственным прототипом — считается различным.
 */
export function equals(left: unknown, right: unknown, depth = 0): boolean {
  if (Object.is(left, right)) return true

  // Ограничитель глубины вместо карты посещённых: аллокация на каждом сравнении
  // обошлась бы дороже редкого лишнего пересчёта. Циклическая структура просто
  // будет признана различной.
  if (depth > 32) return false

  if (left === null || right === null) return false
  if (typeof left !== 'object' || typeof right !== 'object') return false

  const proto = Reflect.getPrototypeOf(left)
  if (proto !== Reflect.getPrototypeOf(right)) return false

  if (Array.isArray(left)) {
    const other = right as unknown[]
    if (left.length !== other.length) return false
    for (let i = 0; i < left.length; i++) {
      const a = left[i]
      const b = other[i]
      // Равные примитивы — самый частый случай внутри коллекций; рекурсивный вызов
      // для них обходился дороже самого сравнения.
      if (a === b) continue
      if (!equals(a, b, depth + 1)) return false
    }
    return true
  }

  if (ArrayBuffer.isView(left)) {
    if (left instanceof DataView) return false
    const a = left as unknown as ArrayLike<number>
    const b = right as unknown as ArrayLike<number>
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  if (left instanceof Date) return left.getTime() === (right as Date).getTime()
  if (left instanceof RegExp) return left.source === (right as RegExp).source && left.flags === (right as RegExp).flags

  if (left instanceof Map) {
    const other = right as Map<unknown, unknown>
    if (left.size !== other.size) return false
    for (const [key, value] of left) {
      if (!other.has(key)) return false
      if (!equals(value, other.get(key), depth + 1)) return false
    }
    return true
  }

  if (left instanceof Set) {
    const other = right as Set<unknown>
    if (left.size !== other.size) return false
    for (const value of left) {
      if (!other.has(value)) return false
    }
    return true
  }

  // Только простые объекты. У экземпляра класса может быть своя семантика
  // равенства, о которой мы ничего не знаем, — сравниваем по ссылке.
  if (proto !== null && proto !== Object.prototype) return false

  const source = left as Record<string, unknown>
  const target = right as Record<string, unknown>

  const keys = Object.keys(source)
  if (keys.length !== Object.keys(target).length) return false

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as string
    const a = source[key]
    const b = target[key]
    if (a === b) {
      // Значение совпало по ссылке — но ключа может не быть у второго объекта,
      // и тогда оба дадут `undefined`. Длины равны, значит достаточно проверить
      // наличие только в этом случае.
      if (a === undefined && !Object.hasOwn(target, key)) return false
      continue
    }
    if (!equals(a, b, depth + 1)) return false
  }
  return true
}
