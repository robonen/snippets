// Ранг — один байт (docs/07 §1). Порт tier/rate из baza.
//
//    7 6 5 4   3 2 1 0
//   └─ tier ─┘ └─ rate ─┘
//
// tier — уровень доступа, биты вложенные (проверка одним сравнением):
//   deny 0000 · read 0001 · post 0011 · pull 0111 · rule 1111
// rate — сложность записи (PoW): число ведущих нулевых бит подписи.

export const TIER = {
  deny: 0b0000,
  read: 0b0001,
  post: 0b0011,
  pull: 0b0111,
  rule: 0b1111,
} as const

export type TierName = keyof typeof TIER

export const RATE = {
  just: 0,
  fast: 8,
  slow: 11,
  long: 12,
  late: 15,
} as const

export type RateName = keyof typeof RATE

/** Собрать байт ранга из уровня и сложности. */
export function rankOf(tier: number, rate: number): number {
  return ((tier & 0b1111) << 4) | (rate & 0b1111)
}

export function tierOf(rank: number): number {
  return (rank >> 4) & 0b1111
}

export function rateOf(rank: number): number {
  return rank & 0b1111
}

/** Достигает ли уровень требуемого. Биты вложенные — одно сравнение. */
export function tierAllows(has: number, need: number): boolean {
  return (has & need) === need
}
