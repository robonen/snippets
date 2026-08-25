import { describe, expect, it } from 'vitest';
import { isPanel, requestView, takeView, viewFromSearch, viewRequest } from './view';

describe('tab display request', () => {
  it('is claimed once', () => {
    requestView({ panel: 'today', compose: true });
    expect(takeView()).toEqual({ panel: 'today', compose: true });
    expect(takeView()).toBeNull();
    expect(viewRequest.value).toBeNull();
  });

  it('is read from the global search link address', () => {
    expect(viewFromSearch('?bucket=scheduled&task=t1')).toEqual({ panel: 'scheduled', task: 't1' });
    expect(viewFromSearch('?bucket=done')).toEqual({ panel: 'done' });
  });

  it('overview is a tab like any other, though not a bucket', () => {
    expect(isPanel('overview')).toBeTruthy();
    expect(isPanel('inbox')).toBeTruthy();
    expect(isPanel('archive')).toBeFalsy();
    expect(viewFromSearch('?bucket=overview')).toEqual({ panel: 'overview' });
  });

  it('unknown tab in the address does not drop the screen into a void', () => {
    expect(viewFromSearch('?bucket=archive&task=t1')).toEqual({ panel: 'inbox', task: 't1' });
    expect(viewFromSearch('?task=t1')).toEqual({ panel: 'inbox', task: 't1' });
  });

  it('address without our params is not a request', () => {
    expect(viewFromSearch('')).toBeNull();
    expect(viewFromSearch('?other=1')).toBeNull();
  });
});
