import { describe, expect, it } from 'vitest';
import { NOTE_TEMPLATES, templateDraft } from './templates';
import type { TemplateId } from './templates';

const DATE = '2026-08-24';

describe(templateDraft, () => {
  it('empty template is empty — otherwise it would not be a "blank sheet"', () => {
    expect(templateDraft('blank', DATE)).toEqual({ title: '', body: '', tags: [] });
  });

  it('daily note is titled with the ISO date: the title is addressable from text', () => {
    expect(templateDraft('daily', DATE).title).toBe(DATE);
  });

  it('meeting carries the date in the body and the "встреча" tag', () => {
    const draft = templateDraft('meeting', DATE);
    expect(draft.title).toBe('Встреча 24.08');
    expect(draft.body).toContain(DATE);
    expect(draft.tags).toEqual(['встреча']);
  });

  it('idea does not invent a title: a human must name it', () => {
    expect(templateDraft('idea', DATE).title).toBe('');
    expect(templateDraft('idea', DATE).tags).toEqual(['идея']);
  });

  it('template depends only on the date: two calls match', () => {
    expect(templateDraft('meeting', DATE)).toEqual(templateDraft('meeting', DATE));
  });

  it('different date — different template, the template does not read the clock', () => {
    expect(templateDraft('daily', '2026-01-02').title).toBe('2026-01-02');
    expect(templateDraft('meeting', '2026-01-02').title).toBe('Встреча 2.01');
  });

  it('template bodies are valid markdown: second-level headings and no trailing spaces', () => {
    for (const template of NOTE_TEMPLATES) {
      const body = templateDraft(template.id, DATE).body;
      expect(body.split('\n').every(line => line === line.trimEnd())).toBeTruthy();
    }
  });

  it('every declared template has a body', () => {
    const ids = NOTE_TEMPLATES.map(template => template.id);
    expect(ids).toEqual<TemplateId[]>(['blank', 'daily', 'meeting', 'idea']);
    for (const id of ids) expect(templateDraft(id, DATE)).toBeDefined();
  });
});
