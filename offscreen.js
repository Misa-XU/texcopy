// offscreen.js — offscreen document: holds the extension clipboardWrite permission,
// the most reliable MV3 clipboard channel (background routes here when the page-side write fails).

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.target === "offscreen" && msg.type === "write-clipboard") {
    navigator.clipboard
      .writeText(msg.text || "")
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async sendResponse
  }
  return false;
});
