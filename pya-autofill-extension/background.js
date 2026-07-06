// Clicking the toolbar icon fills the active PYA tab. If the content script isn't
// there yet (the tab was open before the extension was installed/reloaded, so the
// declared content script never injected), inject it on the fly, then fill — so
// the user never has to refresh the page.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'CARGO_PYA_FILL' });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'CARGO_PYA_FILL' });
    } catch (e2) {
      // Not a member.pya.org page, or access not granted.
    }
  }
});
