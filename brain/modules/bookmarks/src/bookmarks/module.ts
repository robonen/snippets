import { defineModule } from '@brain/module-kit';
import { Bookmark } from 'lucide-vue-next';
import { BookmarksModel, readLink } from './db/models';
import { domainOf, matchesQuery } from './entities/link';
import { requestAdd } from './lib/intent';
import BookmarksScreen from './screens/list/BookmarksScreen.vue';
import UnreadWidget from './widgets/UnreadWidget.vue';

/**
 * Закладки: список ссылок со статусом чтения, тегами и заметкой.
 *
 * Модуль офлайновый насквозь — ни одного сетевого запроса. Заголовок и домен
 * выводятся из самого адреса (`lib/url`): загрузка `<title>` требовала бы сети,
 * CORS и разрешения ходить на произвольный хост, а даёт немногим больше, чем
 * последний сегмент пути.
 */
export const bookmarksModule = defineModule({
  id: 'bookmarks',
  title: 'Закладки',
  icon: Bookmark,
  land: { root: 'bookmarks/root' },
  routes: [
    { path: '', name: 'bookmarks:list', component: BookmarksScreen },
  ],
  widgets: [
    { id: 'unread', title: 'К прочтению', component: UnreadWidget, order: 30 },
  ],
  commands: [
    {
      id: 'add',
      title: 'Добавить ссылку',
      keywords: ['закладка', 'ссылка', 'url', 'link'],
      run: () => {
        requestAdd();
        // Заявку забирает экран закладок при монтировании — см. задачи.
        return '/bookmarks';
      },
    },
  ],
  search: (ctx, query) => {
    const root = ctx.space.root(BookmarksModel);
    return root.links
      .keys()
      .map(id => readLink(id, root.links(id)))
      .filter(link => matchesQuery(link, query))
      // Свежие сверху: сохранённое вчера ищут чаще, чем сохранённое год назад.
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, SEARCH_LIMIT)
      .map(link => ({
        id: `bookmarks:${link.id}`,
        title: link.title,
        subtitle: domainOf(link),
        to: '/bookmarks',
      }));
  },
});

/** Глобальный поиск делит выдачу между модулями: длинный хвост одного из них её топит. */
const SEARCH_LIMIT = 8;
