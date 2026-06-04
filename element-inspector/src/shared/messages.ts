// Message type exchanged between the background worker and the content script.
export const ACTIVATE_MESSAGE = 'element-inspector:activate' as const;

export interface ActivateMessage {
  type: typeof ACTIVATE_MESSAGE;
}
