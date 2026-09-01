import { fmtDay, genitive, monthName, parseMonth, toMonth } from './format';
import { STATUS_LABELS, groupByYear, paidTotal, remainderOf, sortProjects } from '../entities/project';
import type { Entry, Member, Payment, Project, ProjectStatus, Resource } from '../entities/project';

/**
 * Проекты ⇄ markdown в том диалекте, в котором их когда-то вели файлом:
 *
 *   # Проекты 2023
 *   ## Название (февраль — март)
 *   ::: warning … :::            ← статус и пояснение к нему
 *   ### Что это?  ### Стек  ### Команда  ### Оплата  (+ ### Ссылки, ### Журнал)
 *
 * Выгрузка — чтобы унести проекты из приложения читаемым файлом; импорт — чтобы
 * старый файл переехал сюда одной вставкой, а не перепечаткой. Разбор
 * снисходительный: он читает то, что писал человек руками, — и «-», и «—», и
 * «мая» вместо «май».
 */

// ── Выгрузка ─────────────────────────────────────────────────────────────────

const CALLOUT: Record<ProjectStatus, string | null> = {
  active: null,
  paused: 'warning',
  dropped: 'danger',
  done: 'info',
};

/** Что написать во врезке, если пояснения нет: статус должен пережить выгрузку. */
const DEFAULT_NOTE: Record<ProjectStatus, string> = {
  active: 'Проект в работе.',
  paused: 'Проект приостановлен.',
  done: 'Проект завершён.',
  dropped: 'Проект не был реализован.',
};

export function projectToMarkdown(project: Project): string {
  const blocks: string[] = [`## ${project.title.trim() || 'Без названия'} (${periodInline(project)})`];

  const kind = CALLOUT[project.status] ?? (project.statusNote.trim() === '' ? null : 'tip');
  if (kind !== null) {
    blocks.push(`::: ${kind}\n${project.statusNote.trim() || DEFAULT_NOTE[project.status]}\n:::`);
  }
  if (project.summary.trim() !== '') blocks.push(`### Что это?\n${project.summary.trim()}`);
  if (project.stack.length > 0) blocks.push(`### Стек\n${project.stack.map(item => `* ${item}`).join('\n')}`);
  if (project.members.length > 0) blocks.push(`### Команда\n${project.members.map(memberLine).join('\n')}`);
  if (project.links.length > 0) blocks.push(`### Ссылки\n${project.links.map(link => `* [${link.title}](${link.url})`).join('\n')}`);
  if (project.payments.length > 0) blocks.push(`### Оплата\n${paymentsTable(project)}`);
  if (project.journal.length > 0) {
    const entries = [...project.journal].sort((a, b) => a.date.localeCompare(b.date) || a.addedAt - b.addedAt);
    blocks.push(`### Журнал\n${entries.map(entry => `* ${fmtDay(entry.date)} — ${entry.text}`).join('\n')}`);
  }
  return blocks.join('\n\n');
}

/** Все проекты одним файлом: хроника по годам, как велось руками. */
export function projectsToMarkdown(projects: readonly Project[]): string {
  if (projects.length === 0) return '';
  const years = groupByYear(projects).map(group =>
    [`# Проекты ${group.year}`, ...group.projects.toReversed().map(projectToMarkdown)].join('\n\n'));
  return `${years.join('\n\n')}\n`;
}

/** Период в скобках заголовка: год пишется, только когда без него неоднозначно. */
function periodInline(project: Project): string {
  const start = parseMonth(project.startedAt);
  if (start === null) return project.startedAt;
  if (project.endedAt === undefined) return `с ${genitive(start.month)} ${start.year}`;
  const end = parseMonth(project.endedAt);
  if (end === null) return `${monthName(start.month)} ${start.year}`;
  if (start.year === end.year) {
    return start.month === end.month ? monthName(start.month) : `${monthName(start.month)} — ${monthName(end.month)}`;
  }
  return `${monthName(start.month)} ${start.year} — ${monthName(end.month)} ${end.year}`;
}

function memberLine(member: Member): string {
  const name = member.link === undefined ? member.name : `[${member.name}](${member.link})`;
  return member.role.trim() === '' ? `* ${name}` : `* ${name} — ${member.role}`;
}

function paymentsTable(project: Project): string {
  const rows = [...project.payments]
    .sort((a, b) => a.date.localeCompare(b.date) || a.addedAt - b.addedAt)
    .map(payment => `| ${fmtDay(payment.date)} | ${amountCell(payment)} | ${payment.note} |`);
  const remainder = remainderOf(project);
  if (remainder !== undefined) rows.push(`| | | Остаток — ${money(remainder)} |`);
  return ['| Дата | Сумма | Этап |', '|:---:|:---:|:---:|', ...rows].join('\n');
}

function amountCell(payment: Payment): string {
  return payment.share === undefined ? money(payment.amount) : `${money(payment.amount)} (${money(payment.share)})`;
}

/**
 * «50 000 руб.» — как в исходном файле, без символа валюты. Разряды разделены
 * обычным пробелом, а не неразрывным из Intl: файл читают и правят руками,
 * и невидимый спецсимвол в нём — сюрприз при поиске и diff'е.
 */
function money(value: number): string {
  const grouped = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value).replaceAll(/[\u00A0\u202F]/gu, ' ');
  return `${grouped} руб.`;
}

export function exportName(at: Date): string {
  return `projects-${at.toISOString().slice(0, 10)}.md`;
}

// ── Импорт ───────────────────────────────────────────────────────────────────

/** Проект из файла: без id и меток — их даст тот, кто кладёт его в ленд. */
export type ImportedProject = Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'members' | 'payments' | 'links' | 'journal'> & {
  members: Array<Omit<Member, 'id' | 'addedAt'>>;
  payments: Array<Omit<Payment, 'id' | 'addedAt'>>;
  links: Array<Omit<Resource, 'id' | 'addedAt'>>;
  journal: Array<Omit<Entry, 'id' | 'addedAt'>>;
};

const STATUS_BY_CALLOUT: Record<string, ProjectStatus> = {
  warning: 'paused',
  danger: 'dropped',
  info: 'done',
  tip: 'active',
  note: 'active',
};

type Section = 'summary' | 'stack' | 'team' | 'links' | 'payments' | 'journal' | null;

const SECTIONS: Array<[RegExp, Section]> = [
  [/^что это/iu, 'summary'],
  [/^стек/iu, 'stack'],
  [/^команда/iu, 'team'],
  [/^ссылки/iu, 'links'],
  [/^оплат/iu, 'payments'],
  [/^журнал/iu, 'journal'],
];

/**
 * Разобрать файл проектов. Что не узнано — пропущено, а не выброшено
 * исключением: файл писался руками, и один кривой заголовок не должен ронять
 * остальные восемь проектов.
 */
export function importMarkdown(markdown: string, fallbackYear: number): ImportedProject[] {
  const projects: ImportedProject[] = [];
  let year = fallbackYear;
  let current: ImportedProject | null = null;
  let section: Section = null;
  let callout: string | null = null;
  let calloutLines: string[] = [];
  let summaryLines: string[] = [];

  const closeSummary = (): void => {
    if (current !== null && summaryLines.length > 0) current.summary = summaryLines.join('\n').trim();
    summaryLines = [];
  };

  for (const raw of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const line = raw.trimEnd();

    if (callout !== null) {
      if (line.trim() === ':::') {
        if (current !== null) {
          const status = STATUS_BY_CALLOUT[callout];
          if (status !== undefined) current.status = status;
          current.statusNote = calloutLines.join('\n').trim();
        }
        callout = null;
        calloutLines = [];
      }
      else {
        calloutLines.push(line);
      }
      continue;
    }

    // Строка уже без хвостовых пробелов, поэтому год — ровно последние четыре знака.
    if (line.startsWith('# ')) {
      const yearHead = /(\d{4})$/u.exec(line);
      if (yearHead !== null) year = Number(yearHead[1]);
      continue;
    }

    if (line.startsWith('## ')) {
      closeSummary();
      const head = line.slice(3).trim();
      const withPeriod = /^(.*)\(([^()]*)\)$/u.exec(head);
      const period = parsePeriod(withPeriod?.[2] ?? '', year);
      current = {
        title: (withPeriod?.[1] ?? head).trim(),
        summary: '',
        // Без врезки: закончившийся проект — завершён, идущий — в работе.
        status: period.endedAt === undefined ? 'active' : 'done',
        statusNote: '',
        startedAt: period.startedAt,
        ...(period.endedAt !== undefined && { endedAt: period.endedAt }),
        stack: [],
        members: [],
        payments: [],
        links: [],
        journal: [],
      };
      projects.push(current);
      section = null;
      continue;
    }

    const open = /^:::\s*([a-z]+)\s*$/iu.exec(line);
    if (open !== null) {
      callout = (open[1] ?? '').toLowerCase();
      continue;
    }

    if (line.startsWith('### ')) {
      closeSummary();
      const sub = line.slice(4).trim();
      section = SECTIONS.find(([pattern]) => pattern.test(sub))?.[1] ?? null;
      continue;
    }

    if (current === null || section === null) continue;

    switch (section) {
      case 'summary':
        summaryLines.push(line);
        break;
      case 'stack': {
        const item = bullet(line);
        if (item !== null) current.stack.push(item);
        break;
      }
      case 'team': {
        const item = bullet(line);
        if (item !== null) current.members.push(parseMember(item));
        break;
      }
      case 'links': {
        const item = bullet(line);
        const link = item === null ? null : parseLink(item);
        if (link !== null) current.links.push({ title: link.text, url: link.url });
        break;
      }
      case 'payments': {
        const row = parseRow(line);
        if (row === null) break;
        if (row.remainder !== undefined) {
          current.budget = paidTotal(current) + row.remainder;
        }
        else if (row.payment !== undefined) {
          current.payments.push(row.payment);
        }
        break;
      }
      case 'journal': {
        const item = bullet(line);
        const entry = item === null ? null : /^(\d{2}\.\d{2}\.\d{4})\s*[—–-]\s*(\S.*)$/u.exec(item);
        if (entry !== null) current.journal.push({ date: isoDate(entry[1] ?? ''), text: (entry[2] ?? '').trim() });
        break;
      }
      default:
        break;
    }
  }
  closeSummary();
  return projects;
}

function bullet(line: string): string | null {
  const match = /^\s*[*+-]\s+(\S.*)$/u.exec(line);
  return match === null ? null : (match[1] ?? '').trim();
}

function parseLink(text: string): { text: string; url: string } | null {
  const match = /^\[([^\]]*)\]\(([^)\s]+)\)$/u.exec(text.trim());
  return match === null ? null : { text: (match[1] ?? '').trim(), url: match[2] ?? '' };
}

/** «[Рома](https://…) - фронтенд», «Андрей — бэкенд», «Андрей». */
function parseMember(text: string): ImportedProject['members'][number] {
  const [head = '', ...rest] = text.split(/\s+[—–-]\s+/u);
  const role = rest.join(' — ').trim();
  const link = parseLink(head);
  return link === null
    ? { name: head.trim(), role }
    : { name: link.text, role, link: link.url };
}

/** Строка таблицы оплат. Заголовок и разделитель — `null`. */
function parseRow(line: string): { payment?: ImportedProject['payments'][number]; remainder?: number } | null {
  if (!line.trim().startsWith('|')) return null;
  const cells = line.trim().slice(1, -1).split('|').map(cell => cell.trim());
  if (cells.some(cell => /^:?-{2,}:?$/u.test(cell))) return null;
  const [date = '', sum = '', note = ''] = cells;
  const remainder = /остаток/iu.test(note) ? numbers(note)[0] : undefined;
  if (remainder !== undefined && date === '') return { remainder };
  const iso = /^\d{2}\.\d{2}\.\d{4}$/u.test(date) ? isoDate(date) : null;
  const [amount, share] = numbers(sum);
  if (iso === null || amount === undefined) return null;
  return { payment: { date: iso, amount, ...(share !== undefined && { share }), note } };
}

/** Все числа в тексте: «50 000 руб. (25 000 руб.)» → [50000, 25000]. */
function numbers(text: string): number[] {
  return [...text.matchAll(/\d[\d\s]*/gu)]
    .map(match => Number(match[0].replaceAll(/\s/gu, '')))
    .filter(value => Number.isFinite(value));
}

/** «01.04.2023» → «2023-04-01». */
function isoDate(day: string): string {
  const [d = '01', m = '01', y = '2000'] = day.split('.');
  return `${y}-${m}-${d}`;
}

const MONTH_INDEX: Record<string, number> = Object.fromEntries([
  ...Array.from({ length: 12 }, (_, at) => [monthName(at + 1), at + 1] as const),
  ...Array.from({ length: 12 }, (_, at) => [genitive(at + 1), at + 1] as const),
]);

/**
 * «февраль - март», «март 2023 — октябрь 2024», «ноябрь - январь 2024»,
 * «февраль», «с мая 2023». Год без указания — год раздела; конец раньше
 * начала в том же году значит, что проект перевалил через Новый год.
 */
function parsePeriod(text: string, year: number): { startedAt: string; endedAt?: string } {
  const [rawStart = '', rawEnd] = text.split(/\s*[—–-]\s*/u);
  const ongoing = /^с\s+/iu.test(rawStart);
  const start = parseMonthWords(rawStart.replace(/^с\s+/iu, ''));
  const end = rawEnd === undefined ? null : parseMonthWords(rawEnd);

  const startYear = start?.year ?? (end?.year !== undefined && end.month !== undefined && start !== null && start.month > end.month
    ? end.year - 1
    : year);
  const startedAt = start === null ? toMonth(year, 1) : toMonth(startYear, start.month);
  if (ongoing) return { startedAt };
  if (end === null) return start === null ? { startedAt } : { startedAt, endedAt: startedAt };
  const endYear = end.year ?? startYear;
  return { startedAt, endedAt: toMonth(endYear, end.month) };
}

function parseMonthWords(text: string): { month: number; year?: number } | null {
  const words = text.trim().toLowerCase().split(/\s+/u);
  const month = words.map(word => MONTH_INDEX[word]).find(value => value !== undefined);
  if (month === undefined) return null;
  const yearWord = words.find(word => /^\d{4}$/u.test(word));
  return yearWord === undefined ? { month } : { month, year: Number(yearWord) };
}

/** Статус словами — для проверки в тестах и подписей выгрузки. */
export function statusLabel(status: ProjectStatus): string {
  return STATUS_LABELS[status];
}

/** Порядок проектов в файле совпадает с хроникой на экране. */
export function inFileOrder(projects: readonly Project[]): Project[] {
  return sortProjects(projects, 'start');
}
