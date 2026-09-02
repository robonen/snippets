const RU_PLURAL = new Intl.PluralRules('ru-RU');

/**
 * Категория CLDR → номер формы: `one` — «день», `few` — «дня», `many` — «дней».
 * Таблицей, а не `if`-ами: у русского пять категорий из шести, и молча
 * забытая `many` дала бы «5 задачи». `other` — дроби: «1,5 дня».
 */
const FORM_INDEX: Record<Intl.LDMLPluralRule, 0 | 1 | 2> = {
  one: 0,
  two: 1,
  few: 1,
  many: 2,
  other: 1,
  zero: 2,
};

/**
 * Русское склонение по числу: `plural(5, 'задача', 'задачи', 'задач')` → «задач».
 *
 * Считает `Intl.PluralRules`, а не остаток от деления: у 11–14 окончание не
 * такое, как у 1–4, и дроби («1,5 дня») тоже его дело.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const forms: readonly [string, string, string] = [one, few, many];
  return forms[FORM_INDEX[RU_PLURAL.select(count)]];
}
