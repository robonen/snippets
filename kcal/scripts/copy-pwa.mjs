// Дособирает PWA-файлы в статику nitro и проверяет, что офлайн вообще жив.
//
// Порядок сборки таков: клиентское окружение nitro пишет бандл, nitro собирает
// из него статику (.vercel/output/static либо .output/public), и только ПОТОМ
// workbox генерирует sw.js в dist — глобя при этом статику nitro (см.
// globDirectory в vite.config.ts). Здесь sw.js доезжает до статики, а манифест
// прекеша проверяется по содержимому: сервис-воркер без index.html и чанков —
// это офлайн, который умер молча. Если проверка упала — скорее всего, порядок
// «статика до workbox» перестал выполняться или globDirectory смотрит не туда.
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const targets = ['.vercel/output/static', '.output/public'].filter(dir => existsSync(dir));
if (targets.length === 0) {
  console.error('[copy-pwa] статика nitro не найдена — сборка шла без nitro?');
  process.exit(1);
}

const files = readdirSync('dist').filter(name => name === 'sw.js' || name.startsWith('workbox-'));
if (!files.includes('sw.js')) {
  console.error('[copy-pwa] dist/sw.js нет — PWA-плагин не отработал');
  process.exit(1);
}

const sw = readFileSync(join('dist', 'sw.js'), 'utf8');
const chunks = sw.match(/assets\/[\w-]+\.js/g) ?? [];
if (!sw.includes('index.html') || chunks.length === 0) {
  console.error(`[copy-pwa] прекеш пуст (index.html: ${sw.includes('index.html')}, js-чанков: ${chunks.length}) — workbox глобил не ту папку`);
  process.exit(1);
}

for (const dir of targets) {
  for (const name of files) copyFileSync(join('dist', name), join(dir, name));
  console.log(`[copy-pwa] ${files.join(', ')} → ${dir} (в прекеше index.html и ${chunks.length} js)`);
}
