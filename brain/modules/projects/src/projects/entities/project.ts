import { newId } from '../lib/id';
import { parseMonth } from '../lib/format';

/**
 * Проект как доменный объект: плоская запись со вложенными списками, с которой
 * работают экраны, расчёты и выгрузка. Как он лежит в ленде — дело `db/models.ts`.
 *
 * Проект здесь — это ИСТОРИЯ работы, а не карточка в каталоге: у него есть
 * состояние с пояснением, период, кто и за что получал деньги и что решали по
 * ходу. Ровно то, что раньше жило в markdown-файле и было брошено, потому что
 * таблицу оплат руками не поправишь, а статус не сменишь одним нажатием.
 */

export type ProjectStatus = 'active' | 'paused' | 'done' | 'dropped';

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'paused', 'done', 'dropped'];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'В работе',
  paused: 'На паузе',
  done: 'Завершён',
  dropped: 'Отменён',
};

/** Пояснения к выбору статуса — что каждый из них означает на деле. */
export const STATUS_HINTS: Record<ProjectStatus, string> = {
  active: 'Идёт сейчас: задачи, оплаты и решения — живые.',
  paused: 'Отложен. Вернётесь, когда появится время или заказчик.',
  done: 'Сделан и сдан. Продолжения не планируется.',
  dropped: 'Не состоялся или закрыт без результата — с честной пометкой почему.',
};

export interface Member {
  id: string;
  name: string;
  /** «бэкенд», «аналитик», «заказчик». */
  role: string;
  /** Профиль или контакт. Отсутствует, пока не указали. */
  link?: string;
  addedAt: number;
}

export interface Payment {
  id: string;
  /** ISO-дата платежа. */
  date: string;
  /** Сумма платежа целиком, в рублях. */
  amount: number;
  /** Моя доля, если платёж делился на команду. Отсутствует — вся сумма моя. */
  share?: number;
  /** За что: этап, работа, расход. */
  note: string;
  addedAt: number;
}

export interface Resource {
  id: string;
  title: string;
  url: string;
  addedAt: number;
}

/** Запись журнала: решение, событие, смена статуса. */
export interface Entry {
  id: string;
  /** ISO-дата события. */
  date: string;
  text: string;
  addedAt: number;
}

export interface Project {
  id: string;
  title: string;
  /** «Что это?» — суть проекта в пару абзацев. */
  summary: string;
  status: ProjectStatus;
  /** Пояснение к статусу: почему на паузе, чем закончился. */
  statusNote: string;
  /** Месяц начала, `YYYY-MM`. */
  startedAt: string;
  /** Месяц окончания. Отсутствует — проект идёт. */
  endedAt?: string;
  /** Стоимость по договорённости. Отсутствует — считаем только полученное. */
  budget?: number;
  stack: string[];
  members: Member[];
  payments: Payment[];
  links: Resource[];
  journal: Entry[];
  createdAt: number;
  updatedAt: number;
}

export const UNTITLED = 'Без названия';

/** Заготовка нового проекта: только то, что спрашивает форма. */
export function blankProject(
  id: string,
  title: string,
  startedAt: string,
  status: ProjectStatus,
  now: number,
): Project {
  return {
    id,
    title: title.trim(),
    summary: '',
    status,
    statusNote: '',
    startedAt,
    stack: [],
    members: [],
    payments: [],
    links: [],
    journal: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ── Деньги ───────────────────────────────────────────────────────────────────

/** Деньги считаются и по проекту из ленда, и по черновику из файла — им хватает сумм. */
interface Paid {
  payments: ReadonlyArray<Pick<Payment, 'amount' | 'share'>>;
}

/** Получено всего — по сумме платежей целиком. */
export function paidTotal(project: Paid): number {
  return project.payments.reduce((sum, payment) => sum + payment.amount, 0);
}

/** Моя часть: доля, где она указана, иначе весь платёж. */
export function myTotal(project: Paid): number {
  return project.payments.reduce((sum, payment) => sum + (payment.share ?? payment.amount), 0);
}

/** Сколько ещё причитается по договору. Без бюджета остатка нет. */
export function remainderOf(project: Paid & { budget?: number }): number | undefined {
  return project.budget === undefined ? undefined : project.budget - paidTotal(project);
}

/** Моя часть платежей, датированных этим годом. */
export function receivedIn(projects: readonly Project[], year: number): number {
  const prefix = `${year}-`;
  return projects.reduce((sum, project) => sum + project.payments
    .filter(payment => payment.date.startsWith(prefix))
    .reduce((inner, payment) => inner + (payment.share ?? payment.amount), 0), 0);
}

// ── Списки ───────────────────────────────────────────────────────────────────

export type ProjectSort = 'activity' | 'start' | 'title';

export const PROJECT_SORTS: readonly ProjectSort[] = ['activity', 'start', 'title'];

export const SORT_LABELS: Record<ProjectSort, string> = {
  activity: 'По активности',
  start: 'По началу',
  title: 'По названию',
};

/** Год начала — по нему проекты группируются в хронику. */
export function yearOf(project: Pick<Project, 'startedAt'>): number {
  return parseMonth(project.startedAt)?.year ?? 0;
}

/**
 * Порядок списка. Хвост сравнения — `id`: два проекта, начатые в одном месяце,
 * иначе стояли бы в разном порядке на разных устройствах.
 */
export function sortProjects(projects: readonly Project[], sort: ProjectSort = 'activity'): Project[] {
  const by: Record<ProjectSort, (a: Project, b: Project) => number> = {
    activity: (a, b) => b.updatedAt - a.updatedAt,
    start: (a, b) => b.startedAt.localeCompare(a.startedAt),
    title: (a, b) => a.title.localeCompare(b.title, 'ru'),
  };
  return [...projects].sort((a, b) => by[sort](a, b) || a.id.localeCompare(b.id));
}

/** Хроника: годы по убыванию, внутри года — по началу. */
export function groupByYear(projects: readonly Project[]): Array<{ year: number; projects: Project[] }> {
  const years = new Map<number, Project[]>();
  for (const project of sortProjects(projects, 'start')) {
    const year = yearOf(project);
    const bucket = years.get(year);
    if (bucket === undefined) years.set(year, [project]);
    else bucket.push(project);
  }
  return [...years.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, projects: list }));
}

export function countByStatus(projects: readonly Project[]): Record<ProjectStatus, number> {
  const counts: Record<ProjectStatus, number> = { active: 0, paused: 0, done: 0, dropped: 0 };
  for (const project of projects) counts[project.status] += 1;
  return counts;
}

/**
 * Поиск по тому, чем проект помнят: название, стек, люди, суть.
 * Регистр не считается; пустой запрос находит всё.
 */
export function matchesQuery(project: Project, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = [
    project.title,
    project.summary,
    project.statusNote,
    ...project.stack,
    ...project.members.flatMap(member => [member.name, member.role]),
  ].join('\n').toLowerCase();
  return haystack.includes(needle);
}

// ── Правки ───────────────────────────────────────────────────────────────────

/**
 * Совпадает ли содержимое двух снимков. Нужно автосохранению: наполнение формы
 * выглядит как правка, а запись без изменений подняла бы `updatedAt`.
 */
export function sameProject(a: Project, b: Project): boolean {
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
}

/** Цвет статуса — переменная из `projects.css`, у неё есть светлая и тёмная версии. */
export function statusColor(status: ProjectStatus): string {
  return `var(--project-${status})`;
}

/** Что просит пояснение к статусу — у каждого статуса свой вопрос. */
export const STATUS_PROMPTS: Record<ProjectStatus, string> = {
  active: 'Что сейчас в работе и чего ждём',
  paused: 'Почему остановились и что нужно, чтобы вернуться',
  done: 'Чем закончилось и что осталось за бортом',
  dropped: 'Почему не состоялся',
};

/**
 * Сменить статус — с записью в журнал. Смена статуса и есть главное событие
 * проекта («приостановлен», «передан Роме»), и терять её дату — значит через
 * год гадать, когда всё остановилось.
 *
 * Заодно правится период: завершённому и отменённому проекту нужен месяц
 * окончания — подставляется текущий, его можно поправить; вернувшийся в работу
 * проект окончания не имеет. Пояснение к статусу — отдельное поле: оно живёт и
 * правится, а запись журнала — факт перехода с датой.
 */
export function withStatus(project: Project, status: ProjectStatus, today: string, now: number): Project {
  if (project.status === status) return project;
  const entry: Entry = {
    id: newId(),
    date: today,
    text: `${STATUS_LABELS[project.status]} → ${STATUS_LABELS[status]}`,
    addedAt: now,
  };
  const next: Project = { ...project, status, journal: [...project.journal, entry], updatedAt: now };
  if ((status === 'done' || status === 'dropped') && next.endedAt === undefined) {
    const month = today.slice(0, 7);
    next.endedAt = month < project.startedAt ? project.startedAt : month;
  }
  if (status === 'active') delete next.endedAt;
  return next;
}

/** Последнее событие журнала — оно и есть «где мы сейчас». */
export function lastEntry(project: Pick<Project, 'journal'>): Entry | undefined {
  return [...project.journal].sort((a, b) => b.date.localeCompare(a.date) || b.addedAt - a.addedAt)[0];
}

/** Все технологии каталога со счётчиком — для подсказок в поле стека. */
export function stackCounts(projects: readonly Project[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const project of projects) {
    for (const name of project.stack) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));
}

/** Все люди каталога — для подсказок в команде: имя, роль и ссылка с последнего проекта. */
export function knownMembers(projects: readonly Project[]): Member[] {
  const byName = new Map<string, Member>();
  for (const project of sortProjects(projects, 'activity').toReversed()) {
    for (const member of project.members) byName.set(member.name.trim().toLowerCase(), member);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
