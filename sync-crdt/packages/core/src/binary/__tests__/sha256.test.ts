import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { sha256Of, shotInto } from '../sha256'

/**
 * Сверка своей реализации SHA-256 с ОРАКУЛОМ — `crypto.subtle.digest`.
 *
 * Своя реализация появилась вынужденно: `shot` считается внутри синхронной
 * записи ленда, а WebCrypto асинхронен (разбор развилки — в шапке `sha256.ts`).
 * Опасение «второй источник правды по хэшу» снимается ровно этим файлом: боевой
 * путь один, а платформенный хэш остаётся эталоном сверки — та же схема, что у
 * `orderNaive` против `order` (PRINCIPLES.md, правило 2).
 *
 * Расхождение здесь означало бы, что два узла посчитают разные `shot` для одного
 * значения, то есть одно и то же значение приедет по проводу под двумя разными
 * именами. Молча.
 */

async function oracle(bin: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bin))
}

function hex(bin: Uint8Array): string {
  return [...bin].map(b => b.toString(16).padStart(2, '0')).join('')
}

describe('SHA-256 matches the platform implementation', () => {
  test('FIPS 180-4 vectors', async () => {
    // Эталоны из спецификации, а не из собственного прогона: тест, сверяющий код
    // сам с собой, зеленеет и при неверной реализации.
    expect(hex(sha256Of(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(hex(sha256Of(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(
      hex(sha256Of(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
    expect(hex(await oracle(new TextEncoder().encode('abc')))).toBe(hex(sha256Of(new TextEncoder().encode('abc'))))
  })

  test('block boundaries: 55, 56, 63, 64, 65 bytes — where padding lives', async () => {
    // 55/56 — граница, за которой длина не влезает в тот же блок; 64/65 — граница
    // самого блока. Ровно здесь ошибаются все самописные реализации.
    for (const size of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129]) {
      const bin = new Uint8Array(size)
      for (let i = 0; i < size; i++) bin[i] = (i * 7 + 3) & 0xff
      expect(hex(sha256Of(bin)), `${size} B`).toBe(hex(await oracle(bin)))
    }
  })

  test('random inputs — 300 runs against the platform', async () => {
    const samples: Uint8Array[] = []
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 3000 }), bin => {
        samples.push(bin)
        return true
      }),
      { numRuns: 300 },
    )

    for (const bin of samples) {
      expect(hex(sha256Of(bin)), `${bin.length} B`).toBe(hex(await oracle(bin)))
    }
  })

  test('shotInto puts the first 12 bytes at the offset and touches nothing around', () => {
    const src = new TextEncoder().encode('значение подлиннее шестидесяти двух байт, чтобы было интересно')
    const dst = new Uint8Array(32).fill(0xaa)
    shotInto(dst, 8, src, 0, src.length)

    expect(hex(dst.subarray(8, 20))).toBe(hex(sha256Of(src).subarray(0, 12)))
    // Соседи целы: `shot` кладётся прямо в юнит, и промах офсета затёр бы `lead`.
    expect([...dst.subarray(0, 8)]).toEqual(Array(8).fill(0xaa))
    expect([...dst.subarray(20)]).toEqual(Array(12).fill(0xaa))
  })

  test('scratch does not leak between calls', () => {
    // Расписание сообщения — модульная константа (правило 8 горячего пути).
    // Проверка на то, что оно не переносит состояние: два вызова подряд с
    // разными длинами обязаны дать те же хэши, что и поодиночке.
    const first = sha256Of(new Uint8Array(200).fill(1))
    const second = sha256Of(new Uint8Array(5).fill(2))
    expect(hex(sha256Of(new Uint8Array(200).fill(1)))).toBe(hex(first))
    expect(hex(sha256Of(new Uint8Array(5).fill(2)))).toBe(hex(second))
  })
})
