import type { Nutrients } from './nutrition';
import { fmtG } from '../lib/format';

/** Продукт личного каталога. Все значения — на 100 г. */
export interface Food extends Nutrients {
  id: string;
  name: string;
  category: string;
  /** Вес одной штуки в граммах — включает режим «в штуках» при вводе порции. */
  pieceGrams?: number;
  /** EAN/UPC с упаковки — для дедупликации при повторном сканировании. */
  barcode?: string;
  /** Продукт из стартового набора (можно редактировать как свой). */
  builtin?: boolean;
  /** Сколько раз добавляли в дневник — для сортировки «недавних». */
  usedCount: number;
  /** Момент последнего добавления в дневник. */
  lastUsedAt: number;
  /** Последняя введённая порция в граммах — подставляется по умолчанию. */
  lastAmountG?: number;
  createdAt: number;
}

/**
 * Заготовка карточки: то, что подставляют в форму нового продукта — из базы
 * упаковок или из другого источника. Не продукт: у неё нет ни id, ни истории
 * использования, и в каталог она попадает только через форму.
 */
export type FoodDraft = Partial<Pick<
  Food,
  'name' | 'category' | 'kcal' | 'protein' | 'fat' | 'carbs' | 'pieceGrams' | 'barcode'
>>;

/** Продукт каталога с этим штрихкодом — чтобы не заводить его второй раз. */
export function findByBarcode(foods: readonly Food[], barcode: string): Food | undefined {
  return foods.find(food => food.barcode === barcode);
}

/** Порция по умолчанию для продукта: прошлая → одна штука → 100 г. */
export function defaultAmount(food: Food): number {
  return food.lastAmountG ?? food.pieceGrams ?? 100;
}

/** Подпись порции: «150 г» или «2 шт · 110 г» — штуки считаются от веса штуки. */
export function fmtAmount(amountG: number | undefined, pieceGrams: number | undefined): string {
  if (amountG === undefined) return 'порция';
  if (pieceGrams && amountG % pieceGrams === 0) {
    const pieces = amountG / pieceGrams;
    return pieces === 1 ? `1 шт · ${fmtG(amountG)} г` : `${pieces} шт · ${fmtG(amountG)} г`;
  }
  return `${fmtG(amountG)} г`;
}
