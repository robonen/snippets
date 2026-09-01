import { defineModule } from '@brain/module-kit';
import { todayISO } from '@brain/std';
import { BookOpen, CalendarDays, Plus } from 'lucide-vue-next';
import type { ModuleContext, SearchHit } from '@brain/module-kit';
import { createNote, dailyNote } from './db/actions';
import { NOTES_ID, NotesModel, readNote } from './db/models';
import { exportName, notesToMarkdown } from './entities/export';
import { noteLabel, selectNotes } from './entities/note';
import type { Note } from './entities/note';
import { templateDraft } from './entities/templates';
import { downloadText } from './lib/download';
import NotesLayout from './screens/NotesLayout.vue';
import PickNoteScreen from './screens/PickNoteScreen.vue';
import DailyNoteCard from './widgets/DailyNoteCard.vue';

/**
 * Заметки как модуль brain: список, заметка, теги, wikilinks, шаблоны, архив и
 * заметка дня.
 *
 * `seed` не объявлен намеренно. Пусто — нормальное стартовое состояние заметок:
 * посев придумал бы за человека, о чём ему писать, и первое, что он сделал бы, —
 * удалил чужие заметки.
 *
 * Редактор тела — `@robonen/writekit` (`editor/`), но хранится тело по-прежнему
 * строкой markdown, а не документом редактора (docs/00-plan.md, Р6 и риск
 * «два CRDT»): подробности и цена решения — в шапке `db/models.ts`.
 */
export const notesModule = defineModule({
  id: NOTES_ID,
  title: 'Заметки',
  icon: BookOpen,
  land: { root: 'notes/root' },
  /**
   * Маршруты вложены в раму, а не лежат рядом: список и заметка — не два разных
   * экрана, а две части одного (`NotesLayout`). Родитель даёт списку пережить
   * переход к соседней заметке, а именованные дети оставляют `/notes/:id`
   * настоящим адресом — тем самым, который выдают палитра, поиск и упоминания.
   */
  routes: [
    {
      path: '',
      component: NotesLayout,
      children: [
        { path: '', name: 'notes:list', component: PickNoteScreen },
        {
          path: ':id',
          name: 'notes:note',
          component: () => import('./screens/note/NoteScreen.vue'),
          props: true,
        },
      ],
    },
  ],
  widgets: [
    { id: 'daily', title: 'Заметка дня', component: DailyNoteCard, order: 20 },
  ],
  /**
   * Команды только заводят данные и не уводят на экран: `ModuleCommand.run`
   * получает пространство, но не роутер, и придумывать себе навигацию мимо
   * контракта модуль не станет. Заведённая заметка видна в списке сразу.
   */
  commands: [
    {
      id: 'new',
      title: 'Новая заметка',
      keywords: ['заметка', 'note', 'создать'],
      icon: Plus,
      run: ctx => ({ name: 'notes:note', params: { id: createNote(ctx.space).id } }),
    },
    {
      id: 'daily',
      title: 'Заметка дня',
      keywords: ['день', 'сегодня', 'daily', 'журнал'],
      icon: CalendarDays,
      run: ctx => ({ name: 'notes:note', params: { id: dailyNote(ctx.space).id } }),
    },
    {
      id: 'meeting',
      title: 'Заметка со встречи',
      keywords: ['встреча', 'созвон', 'митинг', 'meeting'],
      icon: Plus,
      run: (ctx) => {
        const note = createNote(ctx.space, templateDraft('meeting', todayISO()));
        return { name: 'notes:note', params: { id: note.id } };
      },
    },
    {
      id: 'export',
      title: 'Выгрузить заметки в markdown',
      keywords: ['экспорт', 'выгрузка', 'markdown', 'backup'],
      icon: BookOpen,
      run: (ctx) => {
        const notes = allNotes(ctx);
        // Выгрузка из палитры берёт активные заметки: экранных фильтров у
        // команды нет, а архив — это ровно то, что человек убрал с глаз.
        downloadText(exportName(new Date()), notesToMarkdown(selectNotes(notes)));
      },
    },
  ],
  search: findNotes,
});

/** Сколько заметок отдаём в общую выдачу: палитра — не список, в ней ищут одну. */
const SEARCH_LIMIT = 8;

/**
 * Разовый снимок каталога: хук зовёт оболочка вне реактивного контекста, и
 * наблюдаемое чтение здесь было бы файбером без подписчика.
 */
function allNotes(ctx: ModuleContext): Note[] {
  const root = ctx.space.root(NotesModel);
  return root.notes.keys().map(id => readNote(id, root.notes(id)));
}

/**
 * Выдача в глобальный поиск — по заголовку и тегам.
 *
 * Архивные не приходят: `selectNotes` без среза отдаёт только активные, и это
 * то же самое правило, по которому строится список. Если бы поиск знал своё —
 * убранная с глаз заметка возвращалась бы через палитру.
 */
function findNotes(ctx: ModuleContext, query: string): SearchHit[] {
  if (query.trim() === '') return [];

  const root = ctx.space.root(NotesModel);

  return selectNotes(allNotes(ctx), { query })
    .slice(0, SEARCH_LIMIT)
    .map(note => ({
      id: note.id,
      title: noteLabel(note),
      ...(note.tags.length > 0 && { subtitle: note.tags.map(tag => `#${tag}`).join(' ') }),
      to: { name: 'notes:note', params: { id: note.id } },
      at: root.notes(note.id).$.link(),
    }));
}
