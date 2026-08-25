import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTTPError, defineEventHandler } from 'nitro/h3';

/**
 * SPA-фолбэк: единственный origin отдаёт и API, и PWA (план Р1).
 *
 * Роутер nitro отдаёт приоритет более точным маршрутам и статике из
 * `publicAssets` (`nitro.config.ts`) над этим catch-all — сюда попадает только
 * то, что НЕ нашлось ни там, ни там: `/auth/*`, `/account/*`, `/sync/*` и
 * реальные файлы сборки уже разобраны раньше. Значит, дошедший сюда GET —
 * почти всегда client-side маршрут vue-router (history-режим,
 * `apps/web/src/app/router.ts`): единственный корректный ответ — `index.html`
 * собранного PWA, дальше маршрутизацией займётся вкладка.
 *
 * Путь с точкой в последнем сегменте (`/assets/x-DEADBEEF.js`, отсутствующий
 * из-за протухшего кэша браузера после передеплоя) — НЕ подменяется: если бы
 * такой запрос тоже получал `index.html` с кодом 200, пропавший файл выглядел
 * бы как «страница есть», а на деле в консоли — ошибка разбора JS как HTML.
 * Честный 404 подсказывает браузеру перезагрузить страницу целиком.
 */
const indexHtml = join(dirname(fileURLToPath(import.meta.url)), '../public/index.html');

export default defineEventHandler(async (event) => {
  const last = event.url.pathname.split('/').at(-1) ?? '';
  // `undefined`/пустой возврат в h3 — это 200 с пустым телом, а не 404
  // (проверено рантаймом): «файла нет» обязано быть отказом явно.
  if (last.includes('.')) {
    throw new HTTPError({ status: 404, message: 'не найдено' });
  }

  event.res.headers.set('content-type', 'text/html; charset=utf-8');
  return readFile(indexHtml, 'utf8');
});
