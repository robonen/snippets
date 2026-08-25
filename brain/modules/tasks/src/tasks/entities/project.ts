/**
 * Проект — просто группа задач с именем.
 *
 * Ни статуса, ни дат, ни вложенности: в GTD-lite проект нужен, чтобы отфильтровать
 * список, а «проект как задача со сроком» — это уже вторая сущность со своим
 * жизненным циклом, и она попросит свой экран.
 */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
}

/** По имени; `id` в хвосте — чтобы порядок был полным и одинаковым на всех устройствах. */
export function sortProjects(projects: readonly Project[]): Project[] {
  return [...projects].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id));
}
