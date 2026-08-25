// ─── Диагностика: `Issue` несёт данные, а не текст ───────────────────────────
//
// Контракт слоя (docs/05 §4): чтение НИКОГДА не бросает. Мусор от узла другой
// версии превращается в `blank` плюс ровно один `Issue` с полным контекстом.
//
// В baza этот контракт нарушался в двух местах из пяти: `$mol_schema_instance`
// переопределял `cast` на `guard` и бросал ПРЯМО ИЗ ЧТЕНИЯ, а `list.of()` не
// оборачивал схему в `maybe`, поэтому список с чужим значением ронял геттер
// (реестр, п. 27). Один недобросовестный пир не имеет права уронить приложение.
//
// `Issue` — данные, потому что это ровно требование PRINCIPLES «сообщение
// содержит `cause` с id ленда, пира, юнита». Текст собирается только там, где
// его читает человек, — в приёмнике по умолчанию.

import type { LandId } from '../binary/pack'
import type { Vary } from '../binary/vary'
import type { Head, Peer } from './channel'

export type IssueKind =
  /** Значение не подошло линзе поля. */
  | 'decode'
  /** Запись отклонена правами (S6). */
  | 'denied'
  /** Форма поддерева не та, которую ждёт вид поля. */
  | 'shape'
  /** Ссылка указывает в никуда. */
  | 'broken-link'

export interface Issue {
  readonly kind: IssueKind
  readonly land: LandId
  /** Голова документа. */
  readonly head: Head
  /**
   * Узел, на котором споткнулись.
   *
   * РАСХОЖДЕНИЕ С docs/05: там `self: string`, потому что дизайн писался поверх
   * `Replica`. У ленда на байтах узел — плотный номер; стабильный текст даёт
   * `$.link()`, и платить за него на каждом `Issue` незачем.
   */
  readonly self: Head
  readonly peer: Peer | null
  readonly field: string
  readonly expected: string
  readonly got: string
}

/** Короткое описание значения для `Issue.got`. Только холодный путь. */
export function describe(raw: Vary): string {
  if (raw === null) return 'null'
  if (raw instanceof Uint8Array) return `bytes(${raw.length})`
  if (raw instanceof Date) return `date(${raw.toISOString()})`
  if (Array.isArray(raw)) return `array(${raw.length})`
  if (typeof raw === 'object') return `record(${Object.keys(raw).join(',')})`
  if (typeof raw === 'string') return raw.length > 32 ? `string«${raw.slice(0, 32)}…»` : `string«${raw}»`
  return `${typeof raw}(${String(raw)})`
}

/**
 * Приёмник по умолчанию: предупреждение с ПОЛНЫМ контекстом.
 *
 * Не `throw`, потому что это не наша ошибка, и не молчание, потому что молчание
 * — то, за что в реестре числятся п. 27 и п. 35: у baza отказ прав возвращал
 * `null`, неотличимый от «нет значения».
 */
export function warnIssue(issue: Issue): void {
  console.warn(
    `@sync/model ${issue.kind}: field «${issue.field}» — expected ${issue.expected}, got ${issue.got}`,
    {
      land: issue.land.str,
      head: issue.head,
      self: issue.self,
      peer: issue.peer === null ? null : issue.peer.str,
    },
  )
}

/**
 * Ошибка ПРОГРАММИСТА, а не данных: неизвестная модель, невозможная запись,
 * вид поля, которого этот слой ещё не умеет.
 *
 * Отделена от `Issue` намеренно (PRINCIPLES, «Ошибки»): ожидаемое возвращается
 * значением, исключительное бросается. Мусор от чужого пира — ожидаемое.
 */
export class ModelError extends Error {
  readonly at: string

  constructor(message: string, at: string) {
    super(at === '' ? message : `${message} — ${at}`)
    this.name = 'ModelError'
    this.at = at
  }
}
