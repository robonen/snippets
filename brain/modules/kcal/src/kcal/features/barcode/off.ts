import { round1 } from '@brain/std';
import type { FoodDraft } from '../../entities/food';

/**
 * Open Food Facts — открытая база упакованных продуктов. Barcode-API отдаёт
 * `Access-Control-Allow-Origin: *`, поэтому работает прямо из браузера без
 * бэкенда. Текстовый поиск у OFF из браузера недоступен (legacy-эндпоинт
 * отключён, у search-a-licious нет CORS), поэтому фича — только штрихкоды:
 * сканер или цифры с упаковки.
 */
export interface OffProduct {
  /** EAN/UPC штрихкод. */
  code: string;
  name: string;
  brand?: string;
  /** На 100 г. */
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Вес порции/упаковки с этикетки, если указан. */
  servingGrams?: number;
}

const FIELDS = 'code,product_name,product_name_ru,brands,nutriments,serving_quantity';

export interface OffApiProduct {
  code?: string;
  product_name?: string;
  product_name_ru?: string;
  /** Barcode-API отдаёт строку через запятую, search-a-licious — массив. */
  brands?: string | string[];
  serving_quantity?: string | number;
  nutriments?: Record<string, string | number>;
}

/** Строка с содержимым или `undefined`: пустое поле базы — это отсутствие поля. */
function filled(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text !== undefined && text !== '' ? text : undefined;
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** kcal/100 г: предпочитаем готовое поле, иначе пересчёт из кДж. */
function kcalPer100(nutriments: Record<string, string | number>): number | null {
  const direct = toNumber(nutriments['energy-kcal_100g']);
  if (direct !== null && direct > 0) return direct;
  const kj = toNumber(nutriments['energy_100g']);
  if (kj !== null && kj > 0) return kj / 4.184;
  return null;
}

/** null — в записи нет калорийности или имени, для дневника она бесполезна. */
export function normalizeOffProduct(raw: OffApiProduct): OffProduct | null {
  const nutriments = raw.nutriments ?? {};
  const kcal = kcalPer100(nutriments);
  if (kcal === null || raw.code === undefined || raw.code === '') return null;
  // Русское имя предпочтительнее, но в базе оно часто заведено пустой строкой —
  // такое поле обязано пропускать вперёд общее, а не выигрывать пустотой.
  const name = filled(raw.product_name_ru) ?? filled(raw.product_name) ?? '';
  if (name === '') return null;

  const serving = toNumber(raw.serving_quantity);
  const brandsRaw = Array.isArray(raw.brands) ? raw.brands[0] : raw.brands?.split(',')[0];
  const brand = brandsRaw?.trim();
  return {
    code: raw.code,
    name,
    ...(brand !== undefined && brand !== '' && { brand }),
    kcal: Math.round(kcal),
    protein: round1(toNumber(nutriments['proteins_100g']) ?? 0),
    fat: round1(toNumber(nutriments['fat_100g']) ?? 0),
    carbs: round1(toNumber(nutriments['carbohydrates_100g']) ?? 0),
    ...(serving !== null && serving >= 1 && serving <= 1500 && { servingGrams: serving }),
  };
}

/** Продукт по штрихкоду; null — штрихкода нет в базе. */
export async function fetchOffByBarcode(barcode: string): Promise<OffProduct | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;
  let response: Response;
  try {
    response = await fetch(url);
  }
  catch {
    throw new Error('Нет соединения с базой — проверьте интернет.');
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`База недоступна (${response.status})`);
  const data = await response.json() as { status?: number; product?: OffApiProduct };
  if (data.product === undefined || data.status === 0) return null;
  return normalizeOffProduct({ ...data.product, code: data.product.code ?? barcode });
}

/** Короткий EAN-8 и длинный ITF-14 — границы того, что бывает на упаковке. */
const BARCODE_LENGTH = { min: 8, max: 14 };

/** Только цифры: под штрихкодом их и печатают, а пробелы человек добавляет сам. */
export function digitsOnly(text: string): string {
  return text.replaceAll(/\D/g, '');
}

export function isBarcode(text: string): boolean {
  const digits = digitsOnly(text);
  return digits.length >= BARCODE_LENGTH.min && digits.length <= BARCODE_LENGTH.max;
}

/**
 * Карточка продукта из записи базы — заготовка для формы, а не готовый продукт.
 *
 * Цифры OFF заполняют люди с телефонов, и ошибиться в них так же легко, как
 * опечататься: поэтому найденное открывается формой на проверку, а не падает
 * сразу в каталог.
 */
export function draftFromOff(product: OffProduct): FoodDraft {
  const brand = product.brand;
  const withBrand = brand !== undefined && !product.name.toLowerCase().includes(brand.toLowerCase())
    ? `${product.name} (${brand})`
    : product.name;

  return {
    name: withBrand,
    category: 'Упакованное',
    kcal: product.kcal,
    protein: product.protein,
    fat: product.fat,
    carbs: product.carbs,
    barcode: product.code,
    ...(product.servingGrams !== undefined && { pieceGrams: product.servingGrams }),
  };
}
