import { atom, list, model, parts, t } from '@sync/core';
import { scoped } from '@brain/module-kit';
import type { Doc } from '@sync/core';
import { PROJECT_STATUSES } from '../entities/project';
import type { Entry, Member, Payment, Project, Resource } from '../entities/project';

/**
 * Модели проектов на `@sync/core`: схема — данные, документ — объект каналов,
 * поле — атом. Снимки (`readProject`/`writeProject`) переводят документ в
 * плоский доменный тип и обратно.
 *
 * Строки проекта — участники, оплаты, ссылки, журнал — лежат ВЛОЖЕННЫМИ
 * каталогами (`parts`), а не одним JSON-полем: оплата, добавленная на телефоне,
 * сливается с оплатой, добавленной в это же время на ноутбуке, а строка целиком
 * проиграла бы одну из них по LWW. Стек — `list` по той же причине.
 */

const scope = scoped('projects');

export const MemberModel = model(scope('member'), {
  name: atom(t.string),
  role: atom(t.string),
  link: atom(t.maybe(t.string)),
  addedAt: atom(t.number),
});

export const PaymentModel = model(scope('payment'), {
  date: atom(t.string),
  amount: atom(t.number),
  share: atom(t.maybe(t.number)),
  note: atom(t.string),
  addedAt: atom(t.number),
});

export const ResourceModel = model(scope('resource'), {
  title: atom(t.string),
  url: atom(t.string),
  addedAt: atom(t.number),
});

export const EntryModel = model(scope('entry'), {
  date: atom(t.string),
  text: atom(t.string),
  addedAt: atom(t.number),
});

export const ProjectModel = model(scope('project'), {
  title: atom(t.string),
  summary: atom(t.string),
  status: atom(t.enum(PROJECT_STATUSES).or('active')),
  statusNote: atom(t.string),
  startedAt: atom(t.string),
  endedAt: atom(t.maybe(t.string)),
  budget: atom(t.maybe(t.number)),
  stack: list(t.string),
  members: parts(t.string, 'projects/member'),
  payments: parts(t.string, 'projects/payment'),
  links: parts(t.string, 'projects/resource'),
  journal: parts(t.string, 'projects/entry'),
  createdAt: atom(t.number),
  updatedAt: atom(t.number),
});

/** Корень ленда: каталог проектов по id. */
export const ProjectsModel = model(scope('root'), {
  projects: parts(t.string, 'projects/project'),
});

declare module '@sync/core' {
  interface Models {
    'projects/member': typeof MemberModel;
    'projects/payment': typeof PaymentModel;
    'projects/resource': typeof ResourceModel;
    'projects/entry': typeof EntryModel;
    'projects/project': typeof ProjectModel;
    'projects/root': typeof ProjectsModel;
  }
}

// ── Снимки: документ → доменный тип ──────────────────────────────────────────
// Строки читаются в устойчивом порядке: `keys()` отдаёт ключи в порядке
// вставки, а он у двух устройств разный.

export function readProject(id: string, doc: Doc<'projects/project'>): Project {
  const project: Project = {
    id,
    title: doc.title(),
    summary: doc.summary(),
    status: doc.status(),
    statusNote: doc.statusNote(),
    startedAt: doc.startedAt(),
    stack: [...doc.stack()],
    members: doc.members.keys().map((key) => {
      const member = doc.members(key);
      const item: Member = { id: key, name: member.name(), role: member.role(), addedAt: member.addedAt() };
      const link = member.link();
      if (link !== null) item.link = link;
      return item;
    }).sort(byAdded),
    payments: doc.payments.keys().map((key) => {
      const payment = doc.payments(key);
      const item: Payment = { id: key, date: payment.date(), amount: payment.amount(), note: payment.note(), addedAt: payment.addedAt() };
      const share = payment.share();
      if (share !== null) item.share = share;
      return item;
    }).sort((a, b) => a.date.localeCompare(b.date) || byAdded(a, b)),
    links: doc.links.keys().map((key) => {
      const link = doc.links(key);
      const item: Resource = { id: key, title: link.title(), url: link.url(), addedAt: link.addedAt() };
      return item;
    }).sort(byAdded),
    journal: doc.journal.keys().map((key) => {
      const entry = doc.journal(key);
      const item: Entry = { id: key, date: entry.date(), text: entry.text(), addedAt: entry.addedAt() };
      return item;
    }).sort((a, b) => a.date.localeCompare(b.date) || byAdded(a, b)),
    createdAt: doc.createdAt(),
    updatedAt: doc.updatedAt(),
  };
  const endedAt = doc.endedAt();
  if (endedAt !== null) project.endedAt = endedAt;
  const budget = doc.budget();
  if (budget !== null) project.budget = budget;
  return project;
}

function byAdded(a: { addedAt: number; id: string }, b: { addedAt: number; id: string }): number {
  return a.addedAt - b.addedAt || a.id.localeCompare(b.id);
}

// ── Запись: доменный тип → документ ──────────────────────────────────────────
// Запись равного значения юнитов не порождает, поэтому «сохранить проект
// целиком» дёшево и не шумит в ленде. Строки, которых в снимке больше нет,
// удаляются: снимок — источник истины для формы.

export function writeProject(doc: Doc<'projects/project'>, project: Project): void {
  doc.title(project.title);
  doc.summary(project.summary);
  doc.status(project.status);
  doc.statusNote(project.statusNote);
  doc.startedAt(project.startedAt);
  doc.endedAt(project.endedAt ?? null);
  doc.budget(project.budget ?? null);
  doc.stack.set(project.stack);

  sync(doc.members, project.members, (row, member) => {
    row.name(member.name);
    row.role(member.role);
    row.link(member.link ?? null);
    row.addedAt(member.addedAt);
  });
  sync(doc.payments, project.payments, (row, payment) => {
    row.date(payment.date);
    row.amount(payment.amount);
    row.share(payment.share ?? null);
    row.note(payment.note);
    row.addedAt(payment.addedAt);
  });
  sync(doc.links, project.links, (row, link) => {
    row.title(link.title);
    row.url(link.url);
    row.addedAt(link.addedAt);
  });
  sync(doc.journal, project.journal, (row, entry) => {
    row.date(entry.date);
    row.text(entry.text);
    row.addedAt(entry.addedAt);
  });

  doc.createdAt(project.createdAt);
  doc.updatedAt(project.updatedAt);
}

/** Привести каталог строк к снимку: лишние удалить, остальные записать. */
function sync<Row, Item extends { id: string }>(
  catalog: { (key: string): Row; keys(): readonly string[]; delete(key: string): void },
  items: readonly Item[],
  write: (row: Row, item: Item) => void,
): void {
  const keep = new Set(items.map(item => item.id));
  for (const key of catalog.keys()) {
    if (!keep.has(key)) catalog.delete(key);
  }
  for (const item of items) write(catalog(item.id), item);
}
