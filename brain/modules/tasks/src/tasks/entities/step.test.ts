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

describe('checklist progress', () => {
  it('empty list is not "all done"', () => {
    expect(progressOf([])).toEqual({ done: 0, total: 0, ratio: 0, complete: false });
    expect(progressOf(undefined)).toEqual({ done: 0, total: 0, ratio: 0, complete: false });
  });

  it('counts marks, not titles', () => {
    expect(progressOf(THREE)).toEqual({ done: 1, total: 3, ratio: 1 / 3, complete: false });
  });

  it('all marks — the list is closed', () => {
    const all = THREE.map(item => ({ ...item, doneAt: 1 }));
    expect(progressOf(all)).toEqual({ done: 3, total: 3, ratio: 1, complete: true });
  });

  it('no marks — zero, but the list exists', () => {
    const none = THREE.map(({ doneAt: _doneAt, ...rest }) => rest);
    expect(progressOf(none)).toEqual({ done: 0, total: 3, ratio: 0, complete: false });
  });

  it('property: the share is always within 0…1 and equals done/total', () => {
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

describe('item order', () => {
  it('by manual order, not by marks', () => {
    const shuffled = [THREE[2], THREE[0], THREE[1]].filter((item): item is Step => item !== undefined);
    expect(sortSteps(shuffled).map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('the order is total: equal `order` is split by identifier', () => {
    const same = [step({ id: 'z', order: 1 }), step({ id: 'a', order: 1 })];
    expect(sortSteps(same).map(item => item.id)).toEqual(['a', 'z']);
    expect(sortSteps([...same].reverse()).map(item => item.id)).toEqual(['a', 'z']);
  });

  it('source array is not damaged', () => {
    const source = [...THREE].reverse();
    const copy = [...source];
    sortSteps(source);
    expect(source).toEqual(copy);
  });

  it('new item goes to the end', () => {
    expect(nextStepOrder([])).toBe(1);
    expect(nextStepOrder(THREE)).toBe(4);
  });
});

describe('checklist editing', () => {
  it('item is not created from an empty string', () => {
    expect(createStep('   ', { id: 'x', at: 1, order: 1 })).toBeNull();
    expect(createStep('  Купить  ', { id: 'x', at: 1, order: 1 })?.title).toBe('Купить');
  });

  it('adding puts at the end and does not touch the source array', () => {
    const next = addStep(THREE, 'Четвёртый', { id: 'd', at: 1 });
    expect(next).toHaveLength(4);
    expect(next[3]).toEqual({ id: 'd', title: 'Четвёртый', order: 4 });
    expect(THREE).toHaveLength(3);
  });

  it('adding an empty string does not change the list', () => {
    expect(addStep(THREE, '   ', { id: 'd', at: 1 })).toEqual(THREE);
  });

  it('mark is set and cleared, siblings untouched', () => {
    const marked = setStepDone(THREE, 'a', true, 1_700_500);
    expect(marked[0]?.doneAt).toBe(1_700_500);
    expect(marked[1]).toEqual(THREE[1]);

    const cleared = setStepDone(marked, 'a', false, 1_700_600);
    expect(Object.hasOwn(cleared[0] ?? {}, 'doneAt')).toBeFalsy();
    expect(isStepDone(cleared[0] ?? step())).toBeFalsy();
  });

  it('unknown identifier does not change the list', () => {
    expect(setStepDone(THREE, 'нет-такого', true, 1)).toEqual(THREE);
    expect(renameStep(THREE, 'нет-такого', 'Другое')).toEqual(THREE);
    expect(removeStep(THREE, 'нет-такого')).toEqual(THREE);
  });

  it('renaming to emptiness is a typo, not a rename', () => {
    expect(renameStep(THREE, 'a', '   ')).toEqual(THREE);
    expect(renameStep(THREE, 'a', '  Новый  ')[0]?.title).toBe('Новый');
  });

  it('deletion removes exactly one item', () => {
    expect(removeStep(THREE, 'b').map(item => item.id)).toEqual(['a', 'c']);
  });
});

describe('carrying the checklist into the next repeat occurrence', () => {
  it('marks are cleared, titles and order remain', () => {
    const next = resetSteps(THREE, ['x', 'y', 'z']);
    expect(next).toEqual([
      { id: 'x', title: 'Первый', order: 1 },
      { id: 'y', title: 'Второй', order: 2 },
      { id: 'z', title: 'Третий', order: 3 },
    ]);
  });

  it('order is normalized: numbering gaps do not carry over', () => {
    const gapped = [step({ id: 'a', order: 10 }), step({ id: 'b', order: 40 })];
    expect(resetSteps(gapped, ['x', 'y']).map(item => item.order)).toEqual([1, 2]);
  });

  it('without keys items keep their own — the caller must provide them', () => {
    expect(resetSteps(THREE, []).map(item => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('list comparison', () => {
  it('absence and an empty list are the same', () => {
    expect(sameSteps(undefined, [])).toBeTruthy();
    expect(sameSteps([], undefined)).toBeTruthy();
    expect(sameSteps(undefined, undefined)).toBeTruthy();
  });

  it('array order does not matter — the items themselves do', () => {
    expect(sameSteps(THREE, [...THREE].reverse())).toBeTruthy();
  });

  it('any edit is visible', () => {
    expect(sameSteps(THREE, renameStep(THREE, 'a', 'Другой'))).toBeFalsy();
    expect(sameSteps(THREE, setStepDone(THREE, 'a', true, 1))).toBeFalsy();
    expect(sameSteps(THREE, removeStep(THREE, 'a'))).toBeFalsy();
    expect(sameSteps(THREE, addStep(THREE, 'Ещё', { id: 'd', at: 1 }))).toBeFalsy();
  });

  it('different identifiers with equal titles are different lists', () => {
    expect(sameSteps(THREE, resetSteps(THREE, ['x', 'y', 'z']))).toBeFalsy();
  });
});
