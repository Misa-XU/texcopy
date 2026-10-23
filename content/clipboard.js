// content/clipboard.js — clipboard writing with fallback chain
// Exposes global: CopyAsMarkdownClipboard.writeText(text) → Promise<boolean>

(function () {
  "use strict";

  async function writeViaAsyncAPI(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function writeViaExecCommand(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      // avoid page scroll / flicker
      ta.setAttribute("readonly", "");
      ta.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;";
      document.body.appendChild(ta);

      // save the current selection, restore after copying
      const sel = window.getSelection();
      const savedRanges = [];
      for (let i = 0; i < sel.rangeCount; i++) {
        savedRanges.push(sel.getRangeAt(i).cloneRange());
      }

      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);

      // restore the original selection
      try {
        sel.removeAllRanges();
        for (const r of savedRanges) sel.addRange(r);
      } catch (e) {
        /* failing to restore the selection doesn't affect the copy */
      }
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function writeText(text) {
    if (await writeViaAsyncAPI(text)) return true;
    if (writeViaExecCommand(text)) return true;
    return false;
  }

  window.CopyAsMarkdownClipboard = { writeText };
})();
