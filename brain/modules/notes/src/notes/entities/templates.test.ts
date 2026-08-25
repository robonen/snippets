import { describe, expect, it } from 'vitest';
import { NOTE_TEMPLATES, templateDraft } from './templates';
import type { TemplateId } from './templates';

const DATE = '2026-08-24';

describe(templateDraft, () => {
  it('пустая заготовка пуста — иначе «чистый лист» им бы не был', () => {
    expect(templateDraft('blank', DATE)).toEqual({ title: '', body: '', tags: [] });
  });

  it('заметка дня подписана ISO-датой: заголовок адресуем из текста', () => {
    expect(templateDraft('daily', DATE).title).toBe(DATE);
  });

  it('встреча несёт дату в теле и тег «встреча»', () => {
    const draft = templateDraft('meeting', DATE);
    expect(draft.title).toBe('Встреча 24.08');
    expect(draft.body).toContain(DATE);
    expect(draft.tags).toEqual(['встреча']);
  });

  it('идея заголовка не выдумывает: назвать её должен человек', () => {
    expect(templateDraft('idea', DATE).title).toBe('');
    expect(templateDraft('idea', DATE).tags).toEqual(['идея']);
  });

  it('заготовка зависит только от даты: два вызова совпадают', () => {
    expect(templateDraft('meeting', DATE)).toEqual(templateDraft('meeting', DATE));
  });

  it('другая дата — другая заготовка, часов шаблон не читает', () => {
    expect(templateDraft('daily', '2026-01-02').title).toBe('2026-01-02');
    expect(templateDraft('meeting', '2026-01-02').title).toBe('Встреча 2.01');
  });

  it('тела заготовок годны для markdown: заголовки второго уровня и без хвостовых пробелов', () => {
    for (const template of NOTE_TEMPLATES) {
      const body = templateDraft(template.id, DATE).body;
      expect(body.split('\n').every(line => line === line.trimEnd())).toBeTruthy();
    }
  });

  it('у каждого объявленного шаблона есть заготовка', () => {
    const ids = NOTE_TEMPLATES.map(template => template.id);
    expect(ids).toEqual<TemplateId[]>(['blank', 'daily', 'meeting', 'idea']);
    for (const id of ids) expect(templateDraft(id, DATE)).toBeDefined();
  });
});
