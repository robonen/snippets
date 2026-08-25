import { describe, expect, it } from 'vitest';
import { domainOfUrl, parseUrl } from './url';

describe(parseUrl, () => {
  it('extracts domain and title from the path', () => {
    expect(parseUrl('https://example.com/blog/how-to-cook-pasta')).toEqual({
      url: 'https://example.com/blog/how-to-cook-pasta',
      domain: 'example.com',
      title: 'How to cook pasta',
    });
  });

  it('strips www: the site name is not "www"', () => {
    expect(parseUrl('https://www.example.com/notes')?.domain).toBe('example.com');
  });

  it('port stays part of the domain: localhost:3000 and localhost are different addresses', () => {
    expect(parseUrl('http://localhost:3000/board')?.domain).toBe('localhost:3000');
    // Стандартный порт схемы не показывается — он ничего не различает.
    expect(parseUrl('https://example.com:443/x')?.domain).toBe('example.com');
    expect(parseUrl('https://example.com:8443/x')?.domain).toBe('example.com:8443');
  });

  it('title comes from the last meaningful path segment', () => {
    expect(parseUrl('https://example.com/a/b/final_note.html')?.title).toBe('Final note');
    // Числовой хвост — это id, а не заголовок: отступаем на сегмент назад.
    expect(parseUrl('https://example.com/posts/12345')?.title).toBe('Posts');
    // Хвостовой слэш пустой сегмент не образует.
    expect(parseUrl('https://example.com/design-system/')?.title).toBe('Design system');
  });

  it('without a path the domain becomes the title', () => {
    expect(parseUrl('https://example.com')).toEqual({
      url: 'https://example.com/',
      domain: 'example.com',
      title: 'example.com',
    });
  });

  it('address without a scheme is completed to https', () => {
    expect(parseUrl('example.com/blog')).toEqual({
      url: 'https://example.com/blog',
      domain: 'example.com',
      title: 'Blog',
    });
    expect(parseUrl('www.example.com')?.url).toBe('https://www.example.com/');
  });

  it('percent sequences are decoded, broken ones do not break parsing', () => {
    expect(parseUrl('https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D1%84%D0%B5')?.title).toBe('Кофе');
    expect(parseUrl('https://example.com/%zz')?.title).toBe('%zz');
  });

  it('invalid input — null, not a made-up address', () => {
    expect(parseUrl('')).toBeNull();
    expect(parseUrl('   ')).toBeNull();
    expect(parseUrl('просто фраза с пробелами')).toBeNull();
    expect(parseUrl('https://')).toBeNull();
    expect(parseUrl('://broken')).toBeNull();
  });

  it('schemes other than http and https are not saved: javascript: in href means running foreign code', () => {
    expect(parseUrl('javascript:alert(1)')).toBeNull();
    expect(parseUrl('data:text/html,<script>')).toBeNull();
    expect(parseUrl('mailto:a@b.com')).toBeNull();
    expect(parseUrl('ftp://example.com/file')).toBeNull();
  });

  it('edge whitespace is trimmed', () => {
    expect(parseUrl('  https://example.com/blog  ')?.url).toBe('https://example.com/blog');
  });
});

describe(domainOfUrl, () => {
  it('domain from a string, empty if the address does not parse', () => {
    expect(domainOfUrl('https://www.example.com/a')).toBe('example.com');
    expect(domainOfUrl('не адрес')).toBe('');
  });
});
