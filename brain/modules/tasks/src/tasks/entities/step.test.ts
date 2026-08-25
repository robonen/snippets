import { describe, expect, it } from 'vitest';
import {
  addStep,
  createStep,
  isStepDone,
  nextStepOrder,
  progressOf,
  removeStep,
  renameStep,
  resetSteps,
  sameSteps,
  setStepDone,
  sortSteps,
} from './step';
import type { Step } from './step';

function step(patch: Partial<Step> = {}): Step {
  return { id: 's1', title: 'Шаг', order: 1, ...patch };
}

const THREE: Step[] = [
  step({ id: 'a', title: 'Первый', order: 1 }),
  step({ id: 'b', title: 'Второй', order: 2, doneAt: 1_700_100 }),
  step({ id: 'c', title: 'Третий', order: 3 }),
];

describe('прогресс чек-листа', () => {
  it('пустой список — не «всё сделано»', () => {
    expect(progressOf([])).toEqual({ done: 0, total: 0, ratio: 0, complete: false });
    expect(progressOf(undefined)).toEqual({ done: 0, total: 0, ratio: 0, complete: false });
  });

  it('считает отметки, а не заголовки', () => {
    expect(progressOf(THREE)).toEqual({ done: 1, total: 3, ratio: 1 / 3, complete: false });
  });

  it('все отметки — список закрыт', () => {
    const all = THREE.map(item => ({ ...item, doneAt: 1 }));
    expect(progressOf(all)).toEqual({ done: 3, total: 3, ratio: 1, complete: true });
  });

  it('ни одной отметки — ноль, но список есть', () => {
    const none = THREE.map(({ doneAt: _doneAt, ...rest }) => rest);
    expect(progressOf(none)).toEqual({ done: 0, total: 3, ratio: 0, complete: false });
  });

  it('свойство: доля всегда в 0…1 и равна done/total', () => {
    for (let done = 0; done <= 5; done++) {
      const steps = Array.from({ length: 5 }, (_unused, at) => step({
        id: `s${at}`,
        order: at,
        ...(at < done ? { doneAt: 1 } : {}),
      }));
      const progress = progressOf(steps);
      expect(progress.done).toBe(done);
      expect(progress.ratio).toBeGreaterThanOrEqual(0);
      expect(progress.ratio).toBeLessThanOrEqual(1);
      expect(progress.ratio).toBeCloseTo(done / 5, 10);
    }
  });
});

describe('порядок пунктов', () => {
  it('по ручному порядку, а не по отметкам', () => {
    const shuffled = [THREE[2], THREE[0], THREE[1]].filter((item): item is Step => item !== undefined);
    expect(sortSteps(shuffled).map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('порядок полный: одинаковый `order` разводится идентификатором', () => {
    const same = [step({ id: 'z', order: 1 }), step({ id: 'a', order: 1 })];
    expect(sortSteps(same).map(item => item.id)).toEqual(['a', 'z']);
    expect(sortSteps([...same].reverse()).map(item => item.id)).toEqual(['a', 'z']);
  });

  it('исходный массив не портится', () => {
    const source = [...THREE].reverse();
    const copy = [...source];
    sortSteps(source);
    expect(source).toEqual(copy);
  });

  it('новый пункт встаёт в конец', () => {
    expect(nextStepOrder([])).toBe(1);
    expect(nextStepOrder(THREE)).toBe(4);
  });
});

describe('правка чек-листа', () => {
  it('пункт из пустой строки не создаётся', () => {
    expect(createStep('   ', { id: 'x', at: 1, order: 1 })).toBeNull();
    expect(createStep('  Купить  ', { id: 'x', at: 1, order: 1 })?.title).toBe('Купить');
  });

  it('добавление ставит в конец и не трогает исходный массив', () => {
    const next = addStep(THREE, 'Четвёртый', { id: 'd', at: 1 });
    expect(next).toHaveLength(4);
    expect(next[3]).toEqual({ id: 'd', title: 'Четвёртый', order: 4 });
    expect(THREE).toHaveLength(3);
  });

  it('добавление пустой строки список не меняет', () => {
    expect(addStep(THREE, '   ', { id: 'd', at: 1 })).toEqual(THREE);
  });

  it('отметка ставится и снимается, соседи не трогаются', () => {
    const marked = setStepDone(THREE, 'a', true, 1_700_500);
    expect(marked[0]?.doneAt).toBe(1_700_500);
    expect(marked[1]).toEqual(THREE[1]);

    const cleared = setStepDone(marked, 'a', false, 1_700_600);
    expect(Object.hasOwn(cleared[0] ?? {}, 'doneAt')).toBeFalsy();
    expect(isStepDone(cleared[0] ?? step())).toBeFalsy();
  });

  it('неизвестный идентификатор список не меняет', () => {
    expect(setStepDone(THREE, 'нет-такого', true, 1)).toEqual(THREE);
    expect(renameStep(THREE, 'нет-такого', 'Другое')).toEqual(THREE);
    expect(removeStep(THREE, 'нет-такого')).toEqual(THREE);
  });

  it('переименование в пустоту — опечатка, а не переименование', () => {
    expect(renameStep(THREE, 'a', '   ')).toEqual(THREE);
    expect(renameStep(THREE, 'a', '  Новый  ')[0]?.title).toBe('Новый');
  });

  it('удаление убирает ровно один пункт', () => {
    expect(removeStep(THREE, 'b').map(item => item.id)).toEqual(['a', 'c']);
  });
});

describe('перенос чек-листа в следующее вхождение повтора', () => {
  it('отметки снимаются, заголовки и порядок остаются', () => {
    const next = resetSteps(THREE, ['x', 'y', 'z']);
    expect(next).toEqual([
      { id: 'x', title: 'Первый', order: 1 },
      { id: 'y', title: 'Второй', order: 2 },
      { id: 'z', title: 'Третий', order: 3 },
    ]);
  });

  it('порядок нормализуется: дыры в нумерации не переезжают', () => {
    const gapped = [step({ id: 'a', order: 10 }), step({ id: 'b', order: 40 })];
    expect(resetSteps(gapped, ['x', 'y']).map(item => item.order)).toEqual([1, 2]);
  });

  it('без ключей пункты сохраняют свои — вызывающий обязан их выдать', () => {
    expect(resetSteps(THREE, []).map(item => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('сравнение списков', () => {
  it('отсутствие и пустой список — одно и то же', () => {
    expect(sameSteps(undefined, [])).toBeTruthy();
    expect(sameSteps([], undefined)).toBeTruthy();
    expect(sameSteps(undefined, undefined)).toBeTruthy();
  });

  it('порядок в массиве не важен — важны сами пункты', () => {
    expect(sameSteps(THREE, [...THREE].reverse())).toBeTruthy();
  });

  it('любая правка видна', () => {
    expect(sameSteps(THREE, renameStep(THREE, 'a', 'Другой'))).toBeFalsy();
    expect(sameSteps(THREE, setStepDone(THREE, 'a', true, 1))).toBeFalsy();
    expect(sameSteps(THREE, removeStep(THREE, 'a'))).toBeFalsy();
    expect(sameSteps(THREE, addStep(THREE, 'Ещё', { id: 'd', at: 1 }))).toBeFalsy();
  });

  it('разные идентификаторы при равных заголовках — разные списки', () => {
    expect(sameSteps(THREE, resetSteps(THREE, ['x', 'y', 'z']))).toBeFalsy();
  });
});
