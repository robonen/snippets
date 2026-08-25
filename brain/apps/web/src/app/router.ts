import { createRouter, createWebHistory } from 'vue-router';
import type { Router, RouterHistory } from 'vue-router';
import type { Registry } from '@brain/module-kit';
import StartScreen from '@/shell/StartScreen.vue';
import SettingsScreen from '@/shell/SettingsScreen.vue';
import InboxScreen from '@/shell/InboxScreen.vue';
import SecurityScreen from '@/shell/SecurityScreen.vue';
import ShareScreen from '@/shell/ShareScreen.vue';
import NotFoundScreen from '@/shell/NotFoundScreen.vue';

/**
 * Маршруты оболочки плюс маршруты модулей.
 *
 * Табы kcal не масштабировались на N модулей и не давали ссылок на конкретный
 * экран — а установленному PWA ссылки нужны: шаринг, напоминания и палитра
 * ведут внутрь приложения (план, Р4).
 */
export function createBrainRouter(registry: Registry, history?: RouterHistory): Router {
  return createRouter({
    history: history ?? createWebHistory(),
    routes: [
      // `/` и `/start` — одна страница: домашней в браузере ставят явный
      // адрес, а корень обязан вести туда же, куда логотип.
      { path: '/', name: 'start', component: StartScreen, meta: { title: 'Старт', bare: true } },
      { path: '/start', redirect: '/' },
      { path: '/inbox', name: 'inbox', component: InboxScreen, meta: { title: 'Инбокс' } },
      { path: '/share', name: 'share', component: ShareScreen },
      { path: '/settings', name: 'settings', component: SettingsScreen, meta: { title: 'Настройки' } },
      { path: '/settings/security', name: 'security', component: SecurityScreen, meta: { title: 'Доступ' } },
      ...registry.routes(),
      { path: '/:rest(.*)*', name: 'not-found', component: NotFoundScreen },
    ],
  });
}
