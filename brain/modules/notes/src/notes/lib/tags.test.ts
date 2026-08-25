import { describe, expect, it } from 'vitest';
import { addTag, formatTags, normalizeTag, parseTags, removeTag, toggleTag } from './tags';

describe(normalizeTag, () => {
  it('снимает решётку, пробелы и регистр', () => {
    expect(normalizeTag('  #Работа  ')).toBe('работа');
  });

  it('схлопывает пробелы внутри тега', () => {
    expect(normalizeTag('личные   дела')).toBe('личные дела');
  });

  it('тег из одних решёток и пробелов пустеет', () => {
    expect(normalizeTag('## ')).toBe('');
  });
});

describe(parseTags, () => {
  it('делит строку по запятым и нормализует каждый тег', () => {
    expect(parseTags('Работа, #идеи ,ЧТЕНИЕ')).toEqual(['работа', 'идеи', 'чтение']);
  });

  it('выбрасывает пустые куски', () => {
    expect(parseTags(' , работа,,  ,')).toEqual(['работа']);
  });

  it('схлопывает повторы, сохраняя порядок первого появления', () => {
    expect(parseTags('идеи, Работа, ИДЕИ')).toEqual(['идеи', 'работа']);
  });

  it('пустая строка даёт пустой список', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags('   ')).toEqual([]);
  });
});

describe(addTag, () => {
  it('нормализует добавляемое и дописывает в конец', () => {
    expect(addTag(['работа'], ' #Идеи ')).toEqual(['работа', 'идеи']);
  });

  it('повтор и пустой тег НАБОР НЕ МЕНЯЮТ — возвращается тот же массив', () => {
    // Тождество здесь работает: экран сравнивает снимки, и новый массив с тем
    // же содержимым выглядел бы правкой заметки.
    const tags = ['работа'];
    expect(addTag(tags, 'Работа')).toBe(tags);
    expect(addTag(tags, '  #  ')).toBe(tags);
  });
});

describe(removeTag, () => {
  it('убирает тег, узнавая его в любом написании', () => {
    expect(removeTag(['работа', 'идеи'], '#Работа')).toEqual(['идеи']);
  });

  it('чужой тег набор не меняет', () => {
    const tags = ['работа'];
    expect(removeTag(tags, 'чтение')).toBe(tags);
  });
});

describe(toggleTag, () => {
  it('добавляет отсутствующий и снимает выбранный', () => {
    expect(toggleTag([], 'дом')).toEqual(['дом']);
    expect(toggleTag(['дом', 'работа'], 'дом')).toEqual(['работа']);
  });

  it('двойное переключение возвращает исходный набор', () => {
    expect(toggleTag(toggleTag(['работа'], 'дом'), 'дом')).toEqual(['работа']);
  });
});

describe('круг тегов', () => {
  it('parse ∘ format возвращает тот же список', () => {
    const tags = ['работа', 'идеи', 'личные дела'];
    expect(parseTags(formatTags(tags))).toEqual(tags);
  });

  it('format ∘ parse нормализует ввод к каноническому виду', () => {
    expect(formatTags(parseTags('#Работа ,  идеи'))).toBe('работа, идеи');
  });

  it('пустой список даёт пустую строку — и обратно', () => {
    expect(formatTags([])).toBe('');
    expect(parseTags(formatTags([]))).toEqual([]);
  });
});
