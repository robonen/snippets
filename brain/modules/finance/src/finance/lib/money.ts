/**
 * Деньги: разбор и печать сумм.
 *
 * Сумма везде — ЦЕЛОЕ ЧИСЛО КОПЕЕК. У double нет точного представления для 0,1
 * и 0,2, поэтому «10,10 + 20,20» даёт 30,299999999999997, а месячная сводка из
 * трёхсот таких сложений уезжает от чеков на копейки, которые невозможно
 * объяснить и некуда списать. Целое складывается точно, а рубли появляются
 * только на печати.
 */

/** Число в начале строки: целая часть и необязательная дробная. */
const AMOUNT = /^(\d+)(?:[.,](\d+))?/;

/**
 * Неразрывный пробел: «1 250,50 ₽» не имеет права разорваться переносом строки
 * посередине числа.
 */
const NBSP = '\u00A0';

/** Разряды по три цифры справа налево. */
const GROUPS = /\B(?=(?:\d{3})+$)/g;

/** Найденная сумма и место, где она кончилась. */
export interface AmountMatch {
  /** Сумма в копейках. */
  readonly amount: number;
  /** Индекс за последним символом числа — с него начинается остаток строки. */
  readonly end: number;
}

/**
 * Прочитать сумму в НАЧАЛЕ строки. `null` — строка начинается не с числа.
 *
 * Отдельно от `parseAmount`, потому что у быстрого ввода за числом идёт
 * описание: обеим формам нужна одна и та же грамматика числа, и вторая её
 * копия разошлась бы с первой на первом же «1250,5».
 */
export function matchAmount(input: string): AmountMatch | null {
  const match = AMOUNT.exec(input);
  if (match === null) return null;

  const amount = Number(match[1]) * 100 + fractionToKopecks(match[2]);
  // За пределами безопасного целого это уже не деньги, а опечатка: дальше
  // арифметика теряет единицы, и сумма тихо перестаёт сходиться.
  if (!Number.isSafeInteger(amount)) return null;

  return { amount, end: match[0].length };
}

/**
 * Разобрать сумму целиком: «1250,50» → 125050. `null` — это не сумма.
 *
 * Хвост после числа не прощается: «250 кофе» в поле суммы — почти наверняка
 * промах мимо поля быстрого ввода, и молча записать 250, потеряв «кофе», хуже,
 * чем показать ошибку.
 */
export function parseAmount(input: string): number | null {
  const trimmed = input.trim();
  const match = matchAmount(trimmed);
  if (match === null || match.end !== trimmed.length) return null;
  return match.amount;
}

/** «1 250,50» — сумма без знака валюты, для строк списка. */
export function formatAmount(kopecks: number): string {
  const sign = kopecks < 0 ? '-' : '';
  const abs = Math.abs(Math.round(kopecks));
  const rest = abs % 100;
  return `${sign}${String(Math.trunc(abs / 100)).replaceAll(GROUPS, NBSP)},${String(rest).padStart(2, '0')}`;
}

/**
 * «1 250,50 ₽» — сумма со знаком валюты.
 *
 * Руками, а не `Intl.NumberFormat`: у валютного формата ru-RU разделитель
 * разрядов и отбивка перед знаком менялись между версиями ICU, и тест, пришитый
 * к точной строке, ломался бы от смены рантайма, а не от смены кода.
 */
export function formatMoney(kopecks: number): string {
  return `${formatAmount(kopecks)}${NBSP}₽`;
}

/**
 * «1250,50» — значение для поля ввода: без группировки и без хвоста «,00».
 * Неразрывный пробел внутри числа обратно уже не разбирается.
 */
export function formatMoneyInput(kopecks: number): string {
  const sign = kopecks < 0 ? '-' : '';
  const abs = Math.abs(Math.round(kopecks));
  const rubles = Math.trunc(abs / 100);
  const rest = abs % 100;
  return rest === 0 ? `${sign}${rubles}` : `${sign}${rubles},${String(rest).padStart(2, '0')}`;
}

/**
 * Рубли числом → копейки.
 *
 * Нужно там, где сумму вводят числовым полем: оно отдаёт `number` в рублях, а
 * хранилище принимает только целые копейки. Умножение округляется намеренно —
 * 1250,5 × 100 в double даёт 125050.00000000001, и без округления запись
 * упёрлась бы в `t.int`.
 *
 * `null` — вводить нечего: пустое поле это не ноль.
 */
export function toKopecks(rubles: number | null): number | null {
  if (rubles === null || !Number.isFinite(rubles)) return null;
  const kopecks = Math.round(rubles * 100);
  // За пределами безопасного целого это уже не деньги, а опечатка.
  return Number.isSafeInteger(kopecks) ? kopecks : null;
}

/** Копейки → рубли числом, для того же числового поля. */
export function toRubles(kopecks: number): number {
  return kopecks / 100;
}

/**
 * Дробная часть в копейки. Считается на цифрах, а не через `Number('0.' + …)`:
 * ради этого сумма и живёт в целых.
 */
function fractionToKopecks(digits: string | undefined): number {
  if (digits === undefined) return 0;
  // Три знака: две цифры копеек и одна, по которой округляем. Лишние знаки
  // округляются, а не отбрасываются — «1,999» это 2 ₽, а не 1,99 ₽.
  const padded = `${digits}000`.slice(0, 3);
  const kopecks = Number(padded.slice(0, 2));
  return Number(padded.slice(2, 3)) >= 5 ? kopecks + 1 : kopecks;
}
