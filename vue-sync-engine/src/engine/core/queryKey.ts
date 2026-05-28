import type { QueryKey } from './types'

export function hashKey(key: QueryKey): string {
  let s = '['
  for (let i = 0; i < key.length; i++) {
    if (i > 0) s += ','
    s += stringify(key[i])
  }
  return s + ']'
}

export function entityKey(type: string, id: string | number): string {
  return `${type}\u0000${id}`
}

function stringify(v: unknown): string {
  if (v === null) return 'null'
  const t = typeof v
  if (t === 'string') return JSON.stringify(v)
  if (t === 'number') return v === v && v !== Infinity && v !== -Infinity ? String(v) : 'null'
  if (t === 'boolean') return v ? 'true' : 'false'
  if (t === 'undefined') return 'null'
  if (Array.isArray(v)) {
    let s = '['
    for (let i = 0; i < v.length; i++) {
      if (i > 0) s += ','
      s += stringify(v[i])
    }
    return s + ']'
  }
  if (t === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o).sort()
    let s = '{'
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) s += ','
      const k = keys[i]
      s += JSON.stringify(k) + ':' + stringify(o[k])
    }
    return s + '}'
  }
  return 'null'
}
