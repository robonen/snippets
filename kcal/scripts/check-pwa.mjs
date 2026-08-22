// Проверяет, что PWA действительно жива в собранной статике.
//
// Офлайн ломается тихо: сборка остаётся зелёной, а сервис-воркер либо не
// приезжает вовсе, либо приезжает с пустым прекешем — узнаёшь об этом только с
// телефона в метро. Поэтому здесь три проверки, и каждая роняет сборку:
//   1) sw.js и рантайм workbox лежат В СТАТИКЕ nitro (а не в `dist`, откуда их
//      никто не отдаст — nitro индексирует public на сборке, и доложенный после
//      файл уходит рендерером с `text/html`, браузер такой воркер отвергает);
//   2) в манифесте прекеша есть оболочка `index.html` — на неё ссылается
//      navigateFallback, без неё воркер падает `non-precached-url`;
//   3) в манифесте есть ассеты, то есть глоб смотрел в правильную папку.
//
// Разбирается ИМЕННО манифест, а не файл целиком: подстрока «index.html» есть и
// в `createHandlerBoundToURL("index.html")`, и проверка по всему тексту молчала
// ровно там, где должна была кричать.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = ['.vercel/output/static', '.output/public'].find(base => existsSync(join(base, 'sw.js')));
if (dir === undefined) {
  console.error('[check-pwa] sw.js нет ни в .vercel/output/static, ни в .output/public — PWA-плагин писал не туда либо не отработал');
  process.exit(1);
}

const runtime = readdirSync(dir).filter(name => name.startsWith('workbox-'));
if (runtime.length === 0) {
  console.error(`[check-pwa] в ${dir} нет рантайма workbox-*.js рядом с sw.js`);
  process.exit(1);
}

const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
const start = sw.indexOf('precacheAndRoute(');
const manifest = start < 0 ? '' : sw.slice(start, start + 8000);
const urls = [...manifest.matchAll(/url:"([^"]+)"/g)].map(match => match[1]);
const assets = urls.filter(url => url.endsWith('.js') || url.endsWith('.css'));

if (!urls.includes('index.html') || assets.length === 0) {
  console.error(`[check-pwa] прекеш неполон: записей ${urls.length}, оболочка ${urls.includes('index.html') ? 'есть' : 'ОТСУТСТВУЕТ'}, ассетов ${assets.length}`);
  console.error('[check-pwa] проверьте globDirectory и applyToEnvironment у VitePWA в vite.config.ts');
  process.exit(1);
}

console.warn(`[check-pwa] ${dir}: sw.js + ${runtime.join(', ')}, в прекеше ${urls.length} записей (оболочка + ${assets.length} js/css)`);
