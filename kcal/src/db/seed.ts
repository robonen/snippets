import type { Food } from '@/entities/food';

type SeedFood = Pick<Food, 'name' | 'kcal' | 'protein' | 'fat' | 'carbs' | 'category' | 'pieceGrams'>;

/**
 * Стартовый каталог: типовые продукты по таблицам пищевой ценности, на 100 г.
 * Значения округлены — для дневника важна стабильность оценки, а не лабораторная
 * точность. Всё редактируется как свой продукт.
 */
const SEED: readonly SeedFood[] = [
  // Крупы и гарниры (в готовом виде — так, как еда попадает на весы)
  { category: 'Крупы и гарниры', name: 'Гречка варёная', kcal: 110, protein: 4.2, fat: 1.1, carbs: 21.3 },
  { category: 'Крупы и гарниры', name: 'Рис варёный', kcal: 130, protein: 2.4, fat: 0.4, carbs: 28.6 },
  { category: 'Крупы и гарниры', name: 'Булгур варёный', kcal: 83, protein: 3.1, fat: 0.2, carbs: 18.6 },
  { category: 'Крупы и гарниры', name: 'Овсянка на воде', kcal: 88, protein: 3, fat: 1.7, carbs: 15 },
  { category: 'Крупы и гарниры', name: 'Овсянка на молоке', kcal: 102, protein: 4.1, fat: 3.2, carbs: 14.2 },
  { category: 'Крупы и гарниры', name: 'Макароны варёные', kcal: 155, protein: 5.3, fat: 0.9, carbs: 30.9 },
  { category: 'Крупы и гарниры', name: 'Картофель варёный', kcal: 82, protein: 2, fat: 0.4, carbs: 17 },
  { category: 'Крупы и гарниры', name: 'Картофельное пюре', kcal: 106, protein: 2.2, fat: 3.3, carbs: 16.7 },
  { category: 'Крупы и гарниры', name: 'Картофель жареный', kcal: 192, protein: 2.8, fat: 9.5, carbs: 23.4 },

  // Мясо, птица, рыба (приготовленные)
  { category: 'Мясо и рыба', name: 'Куриная грудка запечённая', kcal: 165, protein: 31, fat: 3.6, carbs: 0 },
  { category: 'Мясо и рыба', name: 'Куриное бедро без кожи', kcal: 195, protein: 24.4, fat: 10.9, carbs: 0 },
  { category: 'Мясо и рыба', name: 'Котлета куриная жареная', kcal: 222, protein: 18, fat: 14, carbs: 6.5 },
  { category: 'Мясо и рыба', name: 'Говядина тушёная', kcal: 232, protein: 25.8, fat: 14.2, carbs: 0 },
  { category: 'Мясо и рыба', name: 'Свинина запечённая', kcal: 271, protein: 25, fat: 19, carbs: 0 },
  { category: 'Мясо и рыба', name: 'Лосось запечённый', kcal: 208, protein: 22, fat: 13, carbs: 0 },
  { category: 'Мясо и рыба', name: 'Треска запечённая', kcal: 90, protein: 20, fat: 0.9, carbs: 0 },
  { category: 'Мясо и рыба', name: 'Тунец консервированный', kcal: 116, protein: 25.5, fat: 1, carbs: 0.2 },
  { category: 'Мясо и рыба', name: 'Креветки варёные', kcal: 99, protein: 21, fat: 1.2, carbs: 0.2 },
  { category: 'Мясо и рыба', name: 'Сосиска молочная', kcal: 261, protein: 11, fat: 23.9, carbs: 1.6, pieceGrams: 50 },
  { category: 'Мясо и рыба', name: 'Колбаса докторская', kcal: 257, protein: 13.7, fat: 22.8, carbs: 0 },

  // Молочное и яйца
  { category: 'Молочное и яйца', name: 'Яйцо куриное', kcal: 157, protein: 12.7, fat: 11.5, carbs: 0.7, pieceGrams: 55 },
  { category: 'Молочное и яйца', name: 'Творог 5%', kcal: 121, protein: 17.2, fat: 5, carbs: 1.8 },
  { category: 'Молочное и яйца', name: 'Творог 9%', kcal: 159, protein: 16.7, fat: 9, carbs: 2 },
  { category: 'Молочное и яйца', name: 'Сыр твёрдый', kcal: 364, protein: 23.2, fat: 29.5, carbs: 0.3 },
  { category: 'Молочное и яйца', name: 'Молоко 2,5%', kcal: 52, protein: 2.8, fat: 2.5, carbs: 4.7 },
  { category: 'Молочное и яйца', name: 'Кефир 2,5%', kcal: 50, protein: 2.8, fat: 2.5, carbs: 3.9 },
  { category: 'Молочное и яйца', name: 'Йогурт греческий 2%', kcal: 66, protein: 8, fat: 2, carbs: 3.5 },
  { category: 'Молочное и яйца', name: 'Сметана 15%', kcal: 158, protein: 2.6, fat: 15, carbs: 3 },
  { category: 'Молочное и яйца', name: 'Масло сливочное', kcal: 748, protein: 0.5, fat: 82.5, carbs: 0.8 },

  // Овощи и фрукты
  { category: 'Овощи и фрукты', name: 'Огурец', kcal: 15, protein: 0.8, fat: 0.1, carbs: 2.8 },
  { category: 'Овощи и фрукты', name: 'Помидор', kcal: 20, protein: 1.1, fat: 0.2, carbs: 3.7 },
  { category: 'Овощи и фрукты', name: 'Капуста белокочанная', kcal: 28, protein: 1.8, fat: 0.2, carbs: 4.7 },
  { category: 'Овощи и фрукты', name: 'Морковь', kcal: 35, protein: 1.3, fat: 0.1, carbs: 6.9 },
  { category: 'Овощи и фрукты', name: 'Салат овощной с маслом', kcal: 90, protein: 1.2, fat: 7, carbs: 5.5 },
  { category: 'Овощи и фрукты', name: 'Банан', kcal: 96, protein: 1.5, fat: 0.2, carbs: 21.8, pieceGrams: 120 },
  { category: 'Овощи и фрукты', name: 'Яблоко', kcal: 47, protein: 0.4, fat: 0.4, carbs: 9.8, pieceGrams: 180 },
  { category: 'Овощи и фрукты', name: 'Апельсин', kcal: 43, protein: 0.9, fat: 0.2, carbs: 8.1, pieceGrams: 150 },
  { category: 'Овощи и фрукты', name: 'Авокадо', kcal: 160, protein: 2, fat: 14.7, carbs: 8.5 },
  { category: 'Овощи и фрукты', name: 'Виноград', kcal: 72, protein: 0.6, fat: 0.6, carbs: 15.4 },

  // Хлеб и выпечка
  { category: 'Хлеб и выпечка', name: 'Хлеб белый', kcal: 265, protein: 8.1, fat: 3.2, carbs: 50.1, pieceGrams: 25 },
  { category: 'Хлеб и выпечка', name: 'Хлеб ржаной', kcal: 210, protein: 6.6, fat: 1.2, carbs: 41.4, pieceGrams: 30 },
  { category: 'Хлеб и выпечка', name: 'Лаваш тонкий', kcal: 275, protein: 9.1, fat: 1.1, carbs: 56 },
  { category: 'Хлеб и выпечка', name: 'Печенье овсяное', kcal: 437, protein: 6.5, fat: 14.4, carbs: 71.8, pieceGrams: 20 },

  // Готовые блюда
  { category: 'Готовые блюда', name: 'Борщ', kcal: 49, protein: 1.6, fat: 2.2, carbs: 5.5 },
  { category: 'Готовые блюда', name: 'Суп куриный с лапшой', kcal: 68, protein: 3.9, fat: 2.1, carbs: 8.2 },
  { category: 'Готовые блюда', name: 'Плов с курицей', kcal: 190, protein: 9.5, fat: 7.5, carbs: 21 },
  { category: 'Готовые блюда', name: 'Пельмени варёные', kcal: 275, protein: 11.9, fat: 12.4, carbs: 29 },
  { category: 'Готовые блюда', name: 'Пицца', kcal: 266, protein: 11, fat: 10.4, carbs: 32.9, pieceGrams: 120 },
  { category: 'Готовые блюда', name: 'Сырники жареные', kcal: 220, protein: 15.5, fat: 9.5, carbs: 18.2, pieceGrams: 75 },
  { category: 'Готовые блюда', name: 'Блины', kcal: 233, protein: 6.1, fat: 12.3, carbs: 26, pieceGrams: 50 },

  // Орехи и сладкое
  { category: 'Орехи и сладкое', name: 'Грецкий орех', kcal: 654, protein: 15.2, fat: 65.2, carbs: 7 },
  { category: 'Орехи и сладкое', name: 'Миндаль', kcal: 609, protein: 18.6, fat: 53.7, carbs: 13 },
  { category: 'Орехи и сладкое', name: 'Арахисовая паста', kcal: 588, protein: 25, fat: 50, carbs: 20 },
  { category: 'Орехи и сладкое', name: 'Шоколад молочный', kcal: 554, protein: 9.8, fat: 34.7, carbs: 50.4, pieceGrams: 6 },
  { category: 'Орехи и сладкое', name: 'Мёд', kcal: 329, protein: 0.8, fat: 0, carbs: 81.5 },
  { category: 'Орехи и сладкое', name: 'Сахар', kcal: 398, protein: 0, fat: 0, carbs: 99.7, pieceGrams: 5 },
  { category: 'Орехи и сладкое', name: 'Мороженое пломбир', kcal: 227, protein: 3.2, fat: 15, carbs: 20.8 },
  { category: 'Орехи и сладкое', name: 'Чипсы картофельные', kcal: 536, protein: 5.5, fat: 34, carbs: 51 },

  // Напитки
  { category: 'Напитки', name: 'Кола', kcal: 42, protein: 0, fat: 0, carbs: 10.6 },
  { category: 'Напитки', name: 'Сок яблочный', kcal: 46, protein: 0.5, fat: 0.1, carbs: 10.1 },
  { category: 'Напитки', name: 'Капучино', kcal: 45, protein: 2.1, fat: 2.3, carbs: 4, pieceGrams: 200 },
  { category: 'Напитки', name: 'Латте', kcal: 47, protein: 2.4, fat: 2.4, carbs: 4.2, pieceGrams: 300 },
  { category: 'Напитки', name: 'Пиво светлое', kcal: 42, protein: 0.5, fat: 0, carbs: 3.5 },
  { category: 'Напитки', name: 'Вино сухое', kcal: 68, protein: 0.2, fat: 0, carbs: 2.6 },
];

/** Стабильные id — сидинг идемпотентен и не плодит дубликатов. */
export const SEED_FOODS: readonly Food[] = SEED.map((item, index) => ({
  ...item,
  id: `seed-${String(index + 1).padStart(3, '0')}`,
  builtin: true,
  usedCount: 0,
  lastUsedAt: 0,
  createdAt: 0,
}));
