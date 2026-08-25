import { describe, expect, it } from 'vitest';
import { isPanel, requestView, takeView, viewFromSearch, viewRequest } from './view';

describe('заявка на показ вкладки', () => {
  it('забирается один раз', () => {
    requestView({ panel: 'today', compose: true });
    expect(takeView()).toEqual({ panel: 'today', compose: true });
    expect(takeView()).toBeNull();
    expect(viewRequest.value).toBeNull();
  });

  it('читается из адреса ссылки глобального поиска', () => {
    expect(viewFromSearch('?bucket=scheduled&task=t1')).toEqual({ panel: 'scheduled', task: 't1' });
    expect(viewFromSearch('?bucket=done')).toEqual({ panel: 'done' });
  });

  it('обзор — такая же вкладка, хоть и не корзина', () => {
    expect(isPanel('overview')).toBeTruthy();
    expect(isPanel('inbox')).toBeTruthy();
    expect(isPanel('archive')).toBeFalsy();
    expect(viewFromSearch('?bucket=overview')).toEqual({ panel: 'overview' });
  });

  it('незнакомая вкладка в адресе не роняет экран в пустоту', () => {
    expect(viewFromSearch('?bucket=archive&task=t1')).toEqual({ panel: 'inbox', task: 't1' });
    expect(viewFromSearch('?task=t1')).toEqual({ panel: 'inbox', task: 't1' });
  });

  it('адрес без наших параметров заявкой не является', () => {
    expect(viewFromSearch('')).toBeNull();
    expect(viewFromSearch('?other=1')).toBeNull();
  });
});
