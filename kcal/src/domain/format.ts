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

/** Подпись порции записи: «150 г» или «2 шт · 110 г». */
export function fmtAmount(amountG: number | undefined, pieceGrams: number | undefined): string {
  if (amountG === undefined) return 'порция';
  if (pieceGrams && amountG % pieceGrams === 0) {
    const pieces = amountG / pieceGrams;
    return pieces === 1 ? `1 шт · ${fmtG(amountG)} г` : `${pieces} шт · ${fmtG(amountG)} г`;
  }
  return `${fmtG(amountG)} г`;
}
