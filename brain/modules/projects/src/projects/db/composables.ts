import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useDoc, useSpace, useValue } from '@sync/vue';
import type { Project } from '../entities/project';
import type { ImportedProject } from '../lib/markdown';
import { createProject, importProjects, removeProject, saveProject } from './actions';
import type { NewProject } from './actions';
import { ProjectsModel, readProject } from './models';

/**
 * Хуки проектов поверх моста `@sync/vue`.
 *
 * Снимок ЦЕЛОЙ коллекции, а не подписка на строку: проектов у человека
 * десятки, один файбер на каталог дешевле файбера на запись. И главное —
 * фильтры и порядок живут на Vue-рефах, а файберный наблюдатель их не видит.
 */

export interface ProjectsState {
  /** Все проекты, недавно тронутые сверху. */
  readonly list: ComputedRef<Project[]>;
  /** Ленд уже прочитан с носителя: пустой список — правда, а не «ещё едет». */
  readonly ready: ComputedRef<boolean>;
}

export function useProjects(): ProjectsState {
  const root = useDoc(ProjectsModel);
  const snapshot = useValue(() => root.projects.keys().map(id => readProject(id, root.projects(id))));
  return {
    list: computed(() => [...(snapshot.value ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)),
    ready: computed(() => snapshot.value !== undefined),
  };
}

export interface ProjectsActions {
  create(draft: NewProject): Project;
  save(project: Project): Project;
  remove(id: string): void;
  import(imported: readonly ImportedProject[]): Project[];
}

export function useActions(): ProjectsActions {
  const space = useSpace();
  return {
    create: draft => createProject(space, draft),
    save: project => saveProject(space, project),
    remove: id => removeProject(space, id),
    import: imported => importProjects(space, imported),
  };
}
