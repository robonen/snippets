const kcalFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const gramFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** «1 840» — целые ккал с неразрывной группировкой. */
export function fmtKcal(value: number): string {
  return kcalFormat.format(Math.round(value));
}

/** «82,5» — граммы с одним знаком, без хвоста «,0». */
export function fmtG(value: number): string {
  return gramFormat.format(value);
}
