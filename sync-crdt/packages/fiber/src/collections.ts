// v8:hot — индексы ленда строятся на этих коллекциях
import { RefNode } from './ref'

/**
 * Карта с гранулярностью по ключу.
 *
 * `$mol_wire_dict` держит один источник оповещений на всю коллекцию: изменение
 * одного ключа будит читателей всех остальных. Для индексов ленда, где на карте
 * висят тысячи пешек, это означало бы полный пересчёт экрана от любой правки
 * (расхождение №1 в реестре PRINCIPLES.md).
 *
 * Здесь у каждого читанного ключа свой узел версии, плюс отдельный узел на «форму» —
 * состав ключей. Читатель одного ключа не просыпается от изменения соседнего.
 *
 * Узлы версий создаются **только при чтении**: записали и никто не читал — ничего не
 * выделено. И удаляются вместе с ключом, поэтому карта версий не растёт на обороте.
 */
export class ReactiveMap<K, V> {
  #raw = new Map<K, V>()
  #versions = new Map<K, RefNode<number>>()
  #shape = new RefNode(0)

  #version(key: K): RefNode<number> {
    let node = this.#versions.get(key)
    if (node === undefined) {
      node = new RefNode(0)
      this.#versions.set(key, node)
    }
    return node
  }

  #bump(key: K): void {
    const node = this.#versions.get(key)
    if (node !== undefined) node.set(node.value + 1)
  }

  get(key: K): V | undefined {
    this.#version(key).get()
    return this.#raw.get(key)
  }

  has(key: K): boolean {
    this.#version(key).get()
    return this.#raw.has(key)
  }

  /** Прочитать без подписки — для внутренних обходов, которым реактивность не нужна. */
  peek(key: K): V | undefined {
    return this.#raw.get(key)
  }

  set(key: K, value: V): this {
    const had = this.#raw.has(key)
    if (had && Object.is(this.#raw.get(key), value)) return this
    this.#raw.set(key, value)
    this.#bump(key)
    if (!had) this.#shape.set(this.#shape.value + 1)
    return this
  }

  delete(key: K): boolean {
    if (!this.#raw.delete(key)) return false
    this.#bump(key)
    // Узел версии больше не нужен: читатель, который проснётся от `#bump`, заведёт
    // себе новый при следующем чтении.
    this.#versions.delete(key)
    this.#shape.set(this.#shape.value + 1)
    return true
  }

  clear(): void {
    if (this.#raw.size === 0) return
    for (const key of this.#raw.keys()) this.#bump(key)
    this.#raw.clear()
    this.#versions.clear()
    this.#shape.set(this.#shape.value + 1)
  }

  get size(): number {
    this.#shape.get()
    return this.#raw.size
  }

  keys(): IterableIterator<K> {
    this.#shape.get()
    return this.#raw.keys()
  }

  values(): IterableIterator<V> {
    this.#shape.get()
    return this.#raw.values()
  }

  entries(): IterableIterator<[K, V]> {
    this.#shape.get()
    return this.#raw.entries()
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries()
  }

  /** Обход с подпиской на состав ключей — как `entries()`, но без промежуточных пар. */
  forEach(visit: (value: V, key: K, map: ReactiveMap<K, V>) => void): void {
    this.#shape.get()
    for (const [key, value] of this.#raw) visit(value, key, this)
  }

  /** Сколько узлов версий живо. Для тестов и devtools. */
  get tracked(): number {
    return this.#versions.size
  }
}

/** Множество с той же гранулярностью, что и {@link ReactiveMap}. */
export class ReactiveSet<V> {
  #raw = new Set<V>()
  #versions = new Map<V, RefNode<number>>()
  #shape = new RefNode(0)

  #version(value: V): RefNode<number> {
    let node = this.#versions.get(value)
    if (node === undefined) {
      node = new RefNode(0)
      this.#versions.set(value, node)
    }
    return node
  }

  #bump(value: V): void {
    const node = this.#versions.get(value)
    if (node !== undefined) node.set(node.value + 1)
  }

  has(value: V): boolean {
    this.#version(value).get()
    return this.#raw.has(value)
  }

  add(value: V): this {
    if (this.#raw.has(value)) return this
    this.#raw.add(value)
    this.#bump(value)
    this.#shape.set(this.#shape.value + 1)
    return this
  }

  delete(value: V): boolean {
    if (!this.#raw.delete(value)) return false
    this.#bump(value)
    this.#versions.delete(value)
    this.#shape.set(this.#shape.value + 1)
    return true
  }

  clear(): void {
    if (this.#raw.size === 0) return
    for (const value of this.#raw) this.#bump(value)
    this.#raw.clear()
    this.#versions.clear()
    this.#shape.set(this.#shape.value + 1)
  }

  get size(): number {
    this.#shape.get()
    return this.#raw.size
  }

  values(): IterableIterator<V> {
    this.#shape.get()
    return this.#raw.values()
  }

  [Symbol.iterator](): IterableIterator<V> {
    return this.values()
  }

  /** Обход с подпиской на состав множества. */
  forEach(visit: (value: V, set: ReactiveSet<V>) => void): void {
    this.#shape.get()
    for (const value of this.#raw) visit(value, this)
  }

  get tracked(): number {
    return this.#versions.size
  }
}

