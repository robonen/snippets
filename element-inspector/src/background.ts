import { ACTIVATE_MESSAGE } from './shared/messages';

// The toolbar icon has no popup, so clicking it fires `action.onClicked`. We relay an
// "activate" message to the content script in the active tab, which starts the picker.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) activate(tab.id);
});

// Keyboard shortcut (Alt+Shift+E by default) declared under `commands` in the manifest.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'activate-picker') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) activate(tab.id);
});

function activate(tabId: number): void {
  chrome.tabs.sendMessage(tabId, { type: ACTIVATE_MESSAGE }).catch(() => {
    // No content script on this page (e.g. chrome://, the Web Store, a PDF viewer).
    // Nothing we can do there — fail silently.
  });
}
