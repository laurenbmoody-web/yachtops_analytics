// Clicking the toolbar icon tells the content script on the active PYA tab to
// fill. (The floating "Fill from Cargo" button on the page does the same thing —
// this just makes the natural "click the extension icon" gesture work too.)
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'CARGO_PYA_FILL' }).catch(() => {
    // No content script here — probably not a member.pya.org page.
  });
});
