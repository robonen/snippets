import { describe, expect, it } from 'vitest';
import { colorKey, formatColor, isTransparent, parseColor, parseHex, parseRgb, rgbaToHex } from './color';

describe('parseRgb', () => {
  it('parses comma rgb', () => {
    expect(parseRgb('rgb(255, 0, 128)')).toEqual({ r: 255, g: 0, b: 128, a: 1 });
  });

  it('parses rgba with alpha', () => {
    expect(parseRgb('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it('parses space syntax with slash alpha', () => {
    expect(parseRgb('rgb(10 20 30 / 0.4)')).toEqual({ r: 10, g: 20, b: 30, a: 0.4 });
  });

  it('returns null for non-rgb', () => {
    expect(parseRgb('#fff')).toBeNull();
  });
});

describe('parseHex', () => {
  it('expands shorthand', () => {
    expect(parseHex('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
  });

  it('parses 8-digit hex with alpha', () => {
    expect(parseHex('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 });
  });

  it('rejects bad hex', () => {
    expect(parseHex('#xyz')).toBeNull();
  });
});

describe('parseColor', () => {
  it('handles both rgb and hex', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor('#010203')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });
});

describe('rgbaToHex', () => {
  it('drops alpha when opaque', () => {
    expect(rgbaToHex({ r: 255, g: 0, b: 128, a: 1 })).toBe('#ff0080');
  });

  it('appends alpha byte when translucent', () => {
    expect(rgbaToHex({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080');
  });
});

describe('colorKey', () => {
  it('is stable and rounds alpha', () => {
    expect(colorKey({ r: 1, g: 2, b: 3, a: 0.333 })).toBe('1,2,3,33');
  });
});

describe('isTransparent / formatColor', () => {
  it('detects fully transparent', () => {
    expect(isTransparent({ r: 0, g: 0, b: 0, a: 0 })).toBe(true);
    expect(isTransparent({ r: 0, g: 0, b: 0, a: 0.1 })).toBe(false);
  });

  it('formats opaque as hex and translucent as rgba', () => {
    expect(formatColor({ r: 255, g: 255, b: 255, a: 1 })).toBe('#ffffff');
    expect(formatColor({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('rgba(255, 0, 0, 0.5)');
  });
});
