// background.js — MV3 service worker
// Responsibilities:
// 1. Register the "Copy as Markdown" context menu item
// 2. Ensure the target tab has the content script (inject on demand via
//    chrome.scripting; activeTab is granted by the context-menu click)
// 3. Ask the content script to serialize the selection; if the page-side
//    clipboard write fails, fall back to writing via an offscreen document
// 4. Notify the page of the final result so it can show a toast

const MENU_ID = "copy-as-markdown";
const CONTENT_FILES = [
  "content/math.js",
  "content/serializer.js",
  "content/clipboard.js",
  "content/main.js",
];

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Copy as Markdown",
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

// ---------- content script bootstrapping ----------

async function pingTab(tabId) {
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: "ping" });
    return !!(resp && resp.pong);
  } catch (e) {
    return false;
  }
}

async function ensureContentScript(tabId) {
  if (await pingTab(tabId)) return true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_FILES,
    });
    return await pingTab(tabId);
  } catch (e) {
    console.warn("[TeXCopy] content script injection failed:", e.message);
    return false;
  }
}

// ---------- offscreen clipboard ----------

let creatingOffscreen = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["CLIPBOARD_WRITE"],
    justification: "Write Markdown converted from the user selection to the system clipboard",
  });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function writeClipboardViaOffscreen(text) {
  try {
    await ensureOffscreen();
    const resp = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "write-clipboard",
      text,
    });
    return !!(resp && resp.ok);
  } catch (e) {
    console.warn("[TeXCopy] offscreen clipboard write failed:", e.message);
    return false;
  }
}

// ---------- menu click main flow ----------

async function notifyTabResult(tabId, ok) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "copy-result", ok });
  } catch (e) {
    /* the page may already be gone */
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
  const tabId = tab.id;

  const hasScript = await ensureContentScript(tabId);

  if (hasScript) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        type: "copy-as-markdown",
      });
      if (resp && resp.ok) return; // written in-page already; toast shown there

      // Serialization succeeded in-page but the clipboard write failed —
      // retry through the offscreen document.
      const markdown = (resp && resp.markdown) || info.selectionText || "";
      if (markdown.trim()) {
        const ok = await writeClipboardViaOffscreen(markdown);
        await notifyTabResult(tabId, ok);
        if (!ok) console.log("[TeXCopy] markdown content:\n" + markdown);
        return;
      }
      await notifyTabResult(tabId, false);
      return;
    } catch (e) {
      console.warn("[TeXCopy] tab messaging failed:", e.message);
    }
  }

  // Content script unavailable (restricted page etc.): at least copy the
  // plain selection text via the offscreen document.
  if (info.selectionText && info.selectionText.trim()) {
    const ok = await writeClipboardViaOffscreen(info.selectionText);
    await notifyTabResult(tabId, ok);
  } else {
    await notifyTabResult(tabId, false);
  }
});
