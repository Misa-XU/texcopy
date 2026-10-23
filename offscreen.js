// offscreen.js — offscreen document: holds the extension clipboardWrite permission,
// the most reliable MV3 clipboard channel (background routes here when the page-side write fails).
//
// IMPORTANT: navigator.clipboard.writeText in an offscreen document can throw
// "NotAllowedError: Document is not focused" (a known Chromium quirk — the offscreen
// document never has OS focus). We therefore fall back to execCommand("copy"),
// which the extension's clipboardWrite permission allows here.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.target === "offscreen" && msg.type === "write-clipboard") {
    writeClipboard(msg.text || "").then((ok) => sendResponse({ ok }));
    return true; // async sendResponse
  }
  return false;
});

async function writeClipboard(text) {
  // Tier A: async clipboard API (works when the document happens to be focused)
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.warn("[TeXCopy offscreen] async clipboard failed, trying execCommand:", e.message);
  }

  // Tier B: execCommand with a hidden textarea (allowed by clipboardWrite permission)
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText =
      "position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) {
    console.error("[TeXCopy offscreen] execCommand fallback failed:", e);
    return false;
  }
}
