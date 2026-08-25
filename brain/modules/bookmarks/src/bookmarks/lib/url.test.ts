import { describe, expect, it } from 'vitest';
import { domainOfUrl, parseUrl } from './url';

describe(parseUrl, () => {
  it('достаёт домен и заголовок из пути', () => {
    expect(parseUrl('https://example.com/blog/how-to-cook-pasta')).toEqual({
      url: 'https://example.com/blog/how-to-cook-pasta',
      domain: 'example.com',
      title: 'How to cook pasta',
    });
  });

  it('срезает www: имя сайта — не «www»', () => {
    expect(parseUrl('https://www.example.com/notes')?.domain).toBe('example.com');
  });

  it('порт остаётся частью домена: localhost:3000 и localhost — разные адреса', () => {
    expect(parseUrl('http://localhost:3000/board')?.domain).toBe('localhost:3000');
    // Стандартный порт схемы не показывается — он ничего не различает.
    expect(parseUrl('https://example.com:443/x')?.domain).toBe('example.com');
    expect(parseUrl('https://example.com:8443/x')?.domain).toBe('example.com:8443');
  });

  it('заголовок берётся из последнего осмысленного подпути', () => {
    expect(parseUrl('https://example.com/a/b/final_note.html')?.title).toBe('Final note');
    // Числовой хвост — это id, а не заголовок: отступаем на сегмент назад.
    expect(parseUrl('https://example.com/posts/12345')?.title).toBe('Posts');
    // Хвостовой слэш пустой сегмент не образует.
    expect(parseUrl('https://example.com/design-system/')?.title).toBe('Design system');
  });

  it('без пути заголовком становится домен', () => {
    expect(parseUrl('https://example.com')).toEqual({
      url: 'https://example.com/',
      domain: 'example.com',
      title: 'example.com',
    });
  });

  it('адрес без схемы дописывается до https', () => {
    expect(parseUrl('example.com/blog')).toEqual({
      url: 'https://example.com/blog',
      domain: 'example.com',
      title: 'Blog',
    });
    expect(parseUrl('www.example.com')?.url).toBe('https://www.example.com/');
  });

  it('процентные последовательности раскрываются, битые не роняют разбор', () => {
    expect(parseUrl('https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D1%84%D0%B5')?.title).toBe('Кофе');
    expect(parseUrl('https://example.com/%zz')?.title).toBe('%zz');
  });

  it('невалидный ввод — null, а не выдуманный адрес', () => {
    expect(parseUrl('')).toBeNull();
    expect(parseUrl('   ')).toBeNull();
    expect(parseUrl('просто фраза с пробелами')).toBeNull();
    expect(parseUrl('https://')).toBeNull();
    expect(parseUrl('://broken')).toBeNull();
  });

  it('схемы кроме http и https не сохраняются: javascript: в href — исполнение чужого кода', () => {
    expect(parseUrl('javascript:alert(1)')).toBeNull();
    expect(parseUrl('data:text/html,<script>')).toBeNull();
    expect(parseUrl('mailto:a@b.com')).toBeNull();
    expect(parseUrl('ftp://example.com/file')).toBeNull();
  });

  it('пробелы по краям срезаются', () => {
    expect(parseUrl('  https://example.com/blog  ')?.url).toBe('https://example.com/blog');
  });
});

describe(domainOfUrl, () => {
  it('домен из строки, пустая — если адрес не разбирается', () => {
    expect(domainOfUrl('https://www.example.com/a')).toBe('example.com');
    expect(domainOfUrl('не адрес')).toBe('');
  });
});
