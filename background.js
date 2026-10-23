// background.js — MV3 service worker
// Responsibilities:
// 1. Register the "Copy as Markdown" context menu item
// 2. Track which frames have the content script (frames self-register on load),
//    and inject on demand via chrome.scripting when none respond
// 3. Find the frame that actually holds the selection (chat UIs may live in iframes)
// 4. Ask that frame to serialize; if the page-side clipboard write fails,
//    fall back to writing via an offscreen document
// 5. Notify the frame of the final result so it can show a toast

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

// ---------- frame registry ----------
// Every injected frame sends "frame-ready" so we know which frameIds to talk to.

const tabFrames = new Map(); // tabId -> Set<frameId>

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "frame-ready" && sender.tab && sender.tab.id != null) {
    if (!tabFrames.has(sender.tab.id)) tabFrames.set(sender.tab.id, new Set());
    tabFrames.get(sender.tab.id).add(sender.frameId ?? 0);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => tabFrames.delete(tabId));
// Clear stale frame ids when the top frame navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") tabFrames.delete(tabId);
});

async function injectAllFrames(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: CONTENT_FILES,
    });
    return true;
  } catch (e) {
    // allFrames injection can fail if some subframe is restricted — retry top frame only
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
      return true;
    } catch (e2) {
      console.warn("[TeXCopy] content script injection failed:", e2.message);
      return false;
    }
  }
}

/** Ask each known frame whether it holds a non-collapsed selection. */
async function findSelectionFrame(tabId) {
  let frameIds = tabFrames.get(tabId);
  if (!frameIds || frameIds.size === 0) frameIds = new Set([0]);
  for (const frameId of frameIds) {
    try {
      const resp = await chrome.tabs.sendMessage(
        tabId,
        { type: "query-selection" },
        { frameId }
      );
      if (resp && resp.hasSelection) return frameId;
    } catch (e) {
      /* frame gone or script not present — try the next one */
    }
  }
  return null;
}

async function ensureSelectionFrame(tabId) {
  let frameId = await findSelectionFrame(tabId);
  if (frameId !== null) return frameId;

  // No frame reported a selection: either the content script is missing
  // (page opened before install / service worker restarted and lost the registry)
  // or the selection is truly gone. Inject everywhere and ask again.
  if (await injectAllFrames(tabId)) {
    // give the freshly injected frames a moment to register
    await new Promise((r) => setTimeout(r, 150));
    frameId = await findSelectionFrame(tabId);
  }
  return frameId;
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

async function notifyFrameResult(tabId, frameId, ok) {
  try {
    await chrome.tabs.sendMessage(
      tabId,
      { type: "copy-result", ok },
      { frameId: frameId ?? 0 }
    );
  } catch (e) {
    /* the page may already be gone */
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
  const tabId = tab.id;

  const frameId = await ensureSelectionFrame(tabId);

  if (frameId !== null) {
    try {
      const resp = await chrome.tabs.sendMessage(
        tabId,
        { type: "copy-as-markdown", fallbackText: info.selectionText || "" },
        { frameId }
      );
      if (resp && resp.ok) return; // written in-page already; toast shown there

      // Serialization succeeded in-page but the clipboard write failed —
      // retry through the offscreen document.
      const markdown = (resp && resp.markdown) || info.selectionText || "";
      if (markdown.trim()) {
        const ok = await writeClipboardViaOffscreen(markdown);
        await notifyFrameResult(tabId, frameId, ok);
        if (!ok) console.log("[TeXCopy] markdown content:\n" + markdown);
        return;
      }
      await notifyFrameResult(tabId, frameId, false);
      return;
    } catch (e) {
      console.warn("[TeXCopy] tab messaging failed:", e.message);
    }
  }

  // No frame holds a selection (restricted page, closed tab, etc.):
  // at least copy the plain selection text via the offscreen document.
  if (info.selectionText && info.selectionText.trim()) {
    const ok = await writeClipboardViaOffscreen(info.selectionText);
    await notifyFrameResult(tabId, 0, ok);
  } else {
    await notifyFrameResult(tabId, 0, false);
  }
});
