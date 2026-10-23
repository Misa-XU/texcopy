// content/main.js — entry point: listens for background messages and runs "Copy as Markdown"
// Returns { ok, markdown } to the background; if the page-side clipboard write fails,
// the background retries via an offscreen document and reports back with a "copy-result" message.

(function () {
  "use strict";

  // Guard against duplicate listener registration when chrome.scripting re-injects
  if (window.__copyAsMarkdownInjected) return;
  window.__copyAsMarkdownInjected = true;

  const TOAST_ID = "__copy-as-md-toast__";

  function showToast(message, ok) {
    try {
      let toast = document.getElementById(TOAST_ID);
      if (!toast) {
        toast = document.createElement("div");
        toast.id = TOAST_ID;
        toast.style.cssText = [
          "position:fixed",
          "bottom:24px",
          "right:24px",
          "z-index:2147483647",
          "padding:10px 16px",
          "border-radius:8px",
          "font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif",
          "color:#fff",
          "box-shadow:0 4px 16px rgba(0,0,0,.25)",
          "opacity:0",
          "transform:translateY(8px)",
          "transition:opacity .2s ease,transform .2s ease",
          "pointer-events:none",
          "max-width:320px",
        ].join(";");
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.style.background = ok ? "#1a7f37" : "#b42318";
      // Force reflow before showing so the CSS transition runs
      void toast.offsetWidth;
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";

      clearTimeout(toast.__timer);
      toast.__timer = setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";
        setTimeout(() => toast.remove(), 300);
      }, 1800);
    } catch (e) {
      /* a toast failure must not break the main flow */
    }
  }

  function hasSelection() {
    const sel = window.getSelection();
    return !!(sel && sel.rangeCount > 0 && !sel.isCollapsed);
  }

  function buildMarkdown(fallbackText) {
    let markdown = "";
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      console.info(
        "[TeXCopy] selection:",
        "ranges=" + sel.rangeCount,
        "chars=" + (sel.toString() || "").length,
        "container=",
        range.commonAncestorContainer
      );
      try {
        markdown = window.CopyAsMarkdownSerializer.serializeRange(range);
      } catch (err) {
        console.error("[TeXCopy] serialization failed:", err);
      }
    }
    if ((!markdown || !markdown.trim()) && fallbackText) {
      console.warn(
        "[TeXCopy] serializer produced no output, falling back to plain selectionText (" +
          fallbackText.length +
          " chars)"
      );
      markdown = fallbackText;
    }
    return markdown || "";
  }

  async function handleCopyAsMarkdown(fallbackText) {
    const markdown = buildMarkdown(fallbackText);
    if (!markdown.trim()) {
      showToast("Nothing to copy — select some content first", false);
      return { ok: false, markdown: "" };
    }

    console.info("[TeXCopy] markdown ready (" + markdown.length + " chars)");
    const ok = await window.CopyAsMarkdownClipboard.writeText(markdown);
    if (ok) {
      showToast("Copied as Markdown ✓", true);
    } else {
      // On failure, don't toast here: the background retries via offscreen and
      // reports the outcome back through the "copy-result" message.
      console.warn("[TeXCopy] in-page clipboard write failed; background will retry via offscreen");
    }
    return { ok, markdown };
  }

  // Register this frame with the background so it can target the frame that
  // actually holds the selection (chat UIs sometimes live in iframes).
  try {
    chrome.runtime.sendMessage({ type: "frame-ready" }).catch(() => {});
  } catch (e) {
    /* extension context invalidated (e.g. after reload) — ignore */
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === "ping") {
      sendResponse({ pong: true });
      return false;
    }

    if (msg.type === "query-selection") {
      sendResponse({ hasSelection: hasSelection() });
      return false;
    }

    if (msg.type === "copy-as-markdown") {
      handleCopyAsMarkdown(msg.fallbackText || "").then(
        (result) => sendResponse(result),
        (err) => {
          console.error("[TeXCopy] handler error:", err);
          sendResponse({ ok: false, markdown: "" });
        }
      );
      return true; // async sendResponse
    }

    if (msg.type === "copy-result") {
      showToast(
        msg.ok ? "Copied as Markdown ✓" : "Copy failed — content logged to console",
        !!msg.ok
      );
      return false;
    }

    return false;
  });
})();
