import type { Space } from '@sync/core';
import { blankProject } from '../entities/project';
import type { Project, ProjectStatus } from '../entities/project';
import { newId } from '../lib/id';
import type { ImportedProject } from '../lib/markdown';
import { ProjectsModel, readProject, writeProject } from './models';

/**
 * Операции над проектами — обычными функциями от `Space`, а не хуками: экраны
 * берут их через `db/composables.ts`, а команды палитры и импорт зовут прямо —
 * у них есть `ctx.space`, но нет setup-контекста.
 */

export interface NewProject {
  title: string;
  startedAt: string;
  status: ProjectStatus;
}

export function listProjects(space: Space): Project[] {
  const root = space.root(ProjectsModel);
  return root.projects.keys().map(id => readProject(id, root.projects(id)));
}

export function findProject(space: Space, id: string): Project | undefined {
  const root = space.root(ProjectsModel);
  return root.projects.has(id) ? readProject(id, root.projects(id)) : undefined;
}

export function createProject(space: Space, draft: NewProject, now: number = Date.now()): Project {
  const project = blankProject(newId(), draft.title, draft.startedAt, draft.status, now);
  saveProject(space, project);
  return project;
}

/** Записать снимок целиком. Метка правки — забота вызывающего: восстановление её не двигает. */
export function saveProject(space: Space, project: Project): Project {
  const root = space.root(ProjectsModel);
  space.edit(() => writeProject(root.projects(project.id), project));
  return project;
}

export function removeProject(space: Space, id: string): void {
  space.root(ProjectsModel).projects.delete(id);
}

/**
 * Положить в ленд проекты из файла: каждому — свой id и метки. Порядок строк
 * внутри проекта фиксируется через `addedAt`, иначе на другом устройстве
 * команда собралась бы в другом порядке.
 */
export function importProjects(space: Space, imported: readonly ImportedProject[], now: number = Date.now()): Project[] {
  return imported.map((draft, index) => {
    const at = now + index;
    const stamp = (offset: number): number => at + offset;
    const project: Project = {
      ...draft,
      id: newId(),
      members: draft.members.map((member, order) => ({ ...member, id: newId(), addedAt: stamp(order) })),
      payments: draft.payments.map((payment, order) => ({ ...payment, id: newId(), addedAt: stamp(order) })),
      links: draft.links.map((link, order) => ({ ...link, id: newId(), addedAt: stamp(order) })),
      journal: draft.journal.map((entry, order) => ({ ...entry, id: newId(), addedAt: stamp(order) })),
      createdAt: at,
      updatedAt: at,
    };
    return saveProject(space, project);
  });
}
