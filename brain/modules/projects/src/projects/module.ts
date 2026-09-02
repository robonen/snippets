import { defineModule, downloadText } from '@brain/module-kit';
import { FolderKanban } from 'lucide-vue-next';
import { listProjects } from './db/actions';
import { STATUS_LABELS, UNTITLED, matchesQuery, sortProjects } from './entities/project';
import { fmtPeriod } from './lib/format';
import { addIntent } from './lib/intent';
import { exportName, projectsToMarkdown } from './lib/markdown';
import ProjectsScreen from './screens/list/ProjectsScreen.vue';
import ProjectsWidget from './widgets/ProjectsWidget.vue';

/**
 * Проекты: история работы над каждым — статус с пояснением, период, стек,
 * команда, оплаты с остатком, ссылки и журнал решений.
 *
 * Это замена markdown-файлу «Проекты 2023», который вёлся руками и был брошен:
 * таблицу оплат в тексте не поправишь, остаток не пересчитается, а статус не
 * сменишь одним нажатием. Файл при этом не забыт — он остался форматом
 * выгрузки и импорта (`lib/markdown.ts`), поэтому старые записи переезжают
 * одной вставкой, а новые можно унести обратно в текст.
 */
export const projectsModule = defineModule({
  id: 'projects',
  title: 'Проекты',
  icon: FolderKanban,
  land: { root: 'projects/root' },
  routes: [
    { path: '', name: 'projects:list', component: ProjectsScreen },
    {
      path: ':id',
      name: 'projects:project',
      component: () => import('./screens/project/ProjectScreen.vue'),
      props: true,
    },
  ],
  widgets: [
    { id: 'overview', title: 'Проекты', component: ProjectsWidget, order: 40 },
  ],
  commands: [
    {
      id: 'new',
      title: 'Новый проект',
      keywords: ['проект', 'project', 'заказ', 'создать'],
      icon: FolderKanban,
      run: () => {
        addIntent.request();
        // Заявку забирает экран проектов при монтировании — как у закладок.
        return '/projects';
      },
    },
    {
      id: 'export',
      title: 'Выгрузить проекты в markdown',
      keywords: ['проекты', 'export', 'markdown', 'md', 'выгрузка'],
      run: (ctx) => {
        downloadText(exportName(new Date()), projectsToMarkdown(listProjects(ctx.space)), 'text/markdown;charset=utf-8');
      },
    },
  ],
  search: (ctx, query) => sortProjects(listProjects(ctx.space).filter(project => matchesQuery(project, query)))
    .slice(0, SEARCH_LIMIT)
    .map(project => ({
      id: `projects:${project.id}`,
      title: project.title || UNTITLED,
      subtitle: `${STATUS_LABELS[project.status]} · ${fmtPeriod(project.startedAt, project.endedAt)}`,
      to: { name: 'projects:project', params: { id: project.id } },
    })),
});

/** Глобальный поиск делит выдачу между модулями: длинный хвост одного из них её топит. */
const SEARCH_LIMIT = 8;
