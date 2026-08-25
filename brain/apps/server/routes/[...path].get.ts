import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTTPError, defineHandler } from 'nitro';

/**
 * SPA-фолбэк: единственный origin отдаёт и API, и PWA.
 *
 * Роутер nitro отдаёт приоритет более точным маршрутам и статике из
 * `publicAssets` (`nitro.config.ts`) над этим catch-all — сюда попадает только
 * то, что НЕ нашлось ни там, ни там: почти всегда client-side маршрут
 * vue-router (history-режим), и единственный корректный ответ — `index.html`
 * собранного PWA.
 *
 * Путь с точкой в последнем сегменте (`/assets/x-DEADBEEF.js`, отсутствующий
 * из-за протухшего кэша браузера после передеплоя) — НЕ подменяется: `index.html`
 * с кодом 200 маскировал бы пропавший файл под «страница есть». Честный 404
 * подсказывает браузеру перезагрузить страницу целиком.
 */
const indexHtml = join(dirname(fileURLToPath(import.meta.url)), '../public/index.html');

/** Один файл на процесс: читать его с диска на каждый переход — работа впустую. */
let cached: Promise<string> | null = null;

export default defineHandler((event) => {
  const last = event.url.pathname.split('/').at(-1) ?? '';
  if (last.includes('.')) {
    throw new HTTPError({ status: 404, message: 'не найдено' });
  }

  cached ??= readFile(indexHtml, 'utf8');
  event.res.headers.set('content-type', 'text/html; charset=utf-8');
  return cached;
});
