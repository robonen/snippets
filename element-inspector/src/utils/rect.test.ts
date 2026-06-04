import { describe, expect, it } from 'vitest';
import { computeBoxModel, gap, roundPx } from './rect';

describe('computeBoxModel', () => {
  const borderBox = { x: 100, y: 100, width: 200, height: 80 };
  const model = computeBoxModel(
    borderBox,
    { top: 10, right: 10, bottom: 10, left: 10 },
    { top: 2, right: 2, bottom: 2, left: 2 },
    { top: 20, right: 20, bottom: 20, left: 20 },
  );

  it('expands the margin box outward', () => {
    expect(model.margin).toEqual({ x: 80, y: 80, width: 240, height: 120 });
  });

  it('keeps the border box as given', () => {
    expect(model.border).toEqual(borderBox);
  });

  it('insets the padding box by the border width', () => {
    expect(model.padding).toEqual({ x: 102, y: 102, width: 196, height: 76 });
  });

  it('insets the content box by border + padding', () => {
    expect(model.content).toEqual({ x: 112, y: 112, width: 176, height: 56 });
  });
});

describe('gap', () => {
  it('measures the horizontal gap between two separated boxes', () => {
    const a = { x: 0, y: 0, width: 50, height: 50 };
    const b = { x: 80, y: 0, width: 50, height: 50 };
    expect(gap(a, b)).toEqual({ dx: 30, dy: 0 });
  });

  it('reports zero on an overlapping axis', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 20, y: 20, width: 40, height: 40 };
    expect(gap(a, b)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('roundPx', () => {
  it('rounds to two decimals', () => {
    expect(roundPx(12.3456)).toBe(12.35);
    expect(roundPx(10)).toBe(10);
  });
});
