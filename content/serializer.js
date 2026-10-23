// content/serializer.js — DOM → Markdown converter (zero dependencies, custom traversal)
// Exposes global: CopyAsMarkdownSerializer.serializeRange(range) / serializeElement(el)

(function () {
  "use strict";

  const MathMod = window.CopyAsMarkdownMath;

  // ---------- noise filtering ----------

  const NOISE_SELECTOR = [
    "script", "style", "noscript", "template", "canvas", "video", "audio",
    "iframe", "button", "input", "select", "textarea", "svg",
    '[aria-hidden="true"]',
    '[role="button"]', '[role="toolbar"]', '[role="menu"]',
  ].join(",");

  // Class-name patterns of copy buttons / toolbars / feedback UI common on AI sites
  const NOISE_CLASS_RE =
    /(copy[-_]?btn|copy[-_]?button|clipboard|toolbar|action[-_]?bar|feedback|like[-_]?btn|dislike|regenerate|retry|speak|tts|share[-_]?btn|md-|header-|footer-|corner)/i;

  function isNoise(el) {
    if (el.matches && el.matches(NOISE_SELECTOR)) {
      // SVG inside math is skipped by the caller (math elements are handed to the math module wholesale)
      return true;
    }
    const cls = (typeof el.className === "string" ? el.className : "") || "";
    const id = el.id || "";
    if (NOISE_CLASS_RE.test(cls) || NOISE_CLASS_RE.test(id)) {
      // To avoid false positives from class names like "md-": restrict to obvious UI tags
      const t = el.tagName.toLowerCase();
      if (t === "button" || t === "a" || t === "div" || t === "span") {
        // Only treat as noise when the element holds no block content and its text is short
        if (el.textContent.trim().length <= 20 && !el.querySelector("p,pre,table,ul,ol,h1,h2,h3,h4,h5,h6")) {
          return true;
        }
      }
    }
    return false;
  }

  function isHidden(el) {
    // KaTeX/MathJax helper layers are visually hidden, but math elements are intercepted
    // by the math module first and never reach here.
    // IMPORTANT: never use getClientRects() here — detached clones always report zero
    // rects, which used to make the whole cloned selection look "hidden".
    const styleAttr = el.getAttribute && el.getAttribute("style");
    if (styleAttr && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(styleAttr)) {
      return true;
    }
    if (!el.isConnected) return false;
    const cs = window.getComputedStyle(el);
    return cs.display === "none" || cs.visibility === "hidden";
  }

  // ---------- utilities ----------

  const BLOCK_TAGS = new Set([
    "p", "div", "section", "article", "main", "header", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "pre", "table", "thead", "tbody",
    "tr", "td", "th", "figure", "figcaption", "details", "summary",
    "dl", "dt", "dd", "form", "fieldset", "hr", "br",
  ]);

  function isBlock(el) {
    const t = el.tagName.toLowerCase();
    if (BLOCK_TAGS.has(t)) return true;
    const display = window.getComputedStyle(el).display;
    return display === "block" || display === "list-item" || display === "table";
  }

  function escapeMd(text) {
    // Only escape characters that truly break Markdown structure.
    // Don't escape < > { } | (pipes are handled per table cell) to avoid noisy backslashes.
    return text.replace(/([\\`*_\[\]])/g, "\\$1");
  }

  function escapeTableCell(text) {
    // Escape only unescaped pipes (avoid double-escaping); handles consecutive "||" correctly
    return text.replace(/(?<!\\)\|/g, "\\|").replace(/\n+/g, " ");
  }

  function collapseInline(text) {
    return text.replace(/[ \t\r\n]+/g, " ");
  }

  // Emphasis markers: move edge whitespace outside the markers ("** bold **" → " **bold** ")
  function applyEmphasis(inner, marker) {
    // don't wrap blank content
    if (!inner || !inner.trim()) return inner;
    const lead = inner.match(/^\s*/)[0];
    const trail = inner.match(/\s*$/)[0];
    const core = inner.slice(lead.length, inner.length - trail.length);
    return lead + marker + core + marker + trail;
  }

  // ---------- code blocks ----------

  function extractCodeLang(pre) {
    const code = pre.querySelector("code") || pre;
    const sources = [code.className, pre.className];
    // the data-language attribute is also common
    const dl = code.getAttribute && (code.getAttribute("data-language") || pre.getAttribute("data-language"));
    if (dl) return dl.trim();
    for (const src of sources) {
      if (!src) continue;
      for (const cls of src.split(/\s+/)) {
        let m = cls.match(/^(?:language|lang|brush)-(.+)$/i);
        if (m) return m[1].toLowerCase();
      }
    }
    return "";
  }

  function serializePre(pre) {
    const lang = extractCodeLang(pre);
    // Code content: prefer the code element's textContent, preserving original newlines
    const codeEl = pre.querySelector("code");
    let code = (codeEl || pre).textContent;
    // strip trailing newlines
    code = code.replace(/\n+$/, "");
    const fence = code.includes("```") ? "````" : "```";
    return "\n\n" + fence + lang + "\n" + code + "\n" + fence + "\n\n";
  }

  // ---------- tables ----------

  function serializeTable(table, range) {
    const rows = [];
    const trs = table.querySelectorAll("tr");
    let maxCols = 0;
    for (const tr of trs) {
      // Partial table selection: keep only rows intersecting the range (rows are atomic)
      if (range && !intersectsRange(tr, range)) continue;
      const cells = [];
      for (const cell of tr.querySelectorAll("td,th")) {
        cells.push(escapeTableCell(serializeChildrenInlineish(cell).trim()));
      }
      maxCols = Math.max(maxCols, cells.length);
      rows.push({ cells, isHeader: tr.parentElement && tr.parentElement.tagName.toLowerCase() === "thead" });
    }
    if (rows.length === 0 || maxCols === 0) return "";

    const lines = [];
    // use thead when present, otherwise treat the first row as the header
    const headerIdx = rows.findIndex((r) => r.isHeader);
    const header = headerIdx >= 0 ? rows[headerIdx] : rows[0];
    const body = headerIdx >= 0 ? rows.filter((r, i) => i !== headerIdx) : rows.slice(1);

    const pad = (cells) => {
      const c = cells.slice(0, maxCols);
      while (c.length < maxCols) c.push("");
      return "| " + c.join(" | ") + " |";
    };

    lines.push(pad(header.cells));
    lines.push("|" + Array(maxCols).fill(" --- ").join("|") + "|");
    for (const r of body) lines.push(pad(r.cells));

    return "\n\n" + lines.join("\n") + "\n\n";
  }

  // Inside table cells: flatten blocks to a single line
  function serializeChildrenInlineish(el) {
    return serializeChildren(el).replace(/\n{2,}/g, " ").replace(/\n/g, " ");
  }

  // ---------- lists ----------

  function serializeList(el, depth, range) {
    const ordered = el.tagName.toLowerCase() === "ol";
    const startAttr = ordered ? parseInt(el.getAttribute("start") || "1", 10) : 1;
    let idx = Number.isFinite(startAttr) ? startAttr : 1;
    let out = "";
    const indent = "  ".repeat(depth);

    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== "li") continue;
      if (range && !intersectsRange(li, range)) { idx++; continue; }
      const marker = ordered ? idx++ + ". " : "- ";

      // li content = inline content + nested lists handled separately
      let inline = "";
      let nested = "";
      for (const child of Array.from(li.childNodes)) {
        if (range && !intersectsRange(child, range)) continue;
        if (child.nodeType === Node.ELEMENT_NODE) {
          const t = child.tagName.toLowerCase();
          if (t === "ul" || t === "ol") {
            nested += serializeList(child, depth + 1, range);
            continue;
          }
          if (t === "p" || t === "div") {
            // Paragraphs inside li: the first joins the item line, the rest become indented continuation lines
            const ptxt = (range
              ? serializeChildrenInRange(child, range, depth)
              : serializeChildren(child, depth)
            ).trim();
            if (!inline) inline = ptxt;
            else inline += "\n" + indent + "  " + ptxt;
            continue;
          }
          if (t === "pre") {
            nested += "\n" + indent + "  " + serializePre(child).trim().split("\n").join("\n" + indent + "  ") + "\n";
            continue;
          }
        }
        inline += range
          ? serializeNodeInRange(child, range, depth)
          : serializeNode(child, depth);
      }

      inline = inline.trim().replace(/\n{2,}/g, "\n" + indent + "  ");
      out += indent + marker + (inline || "") + "\n";
      if (nested) out += nested.replace(/^\n+/, "");
    }
    return "\n" + out + "\n";
  }

  // ---------- blockquotes ----------

  function serializeBlockquote(el) {
    const inner = serializeChildren(el).trim();
    const prefixed = inner
      .split("\n")
      .map((line) => (line.length ? "> " + line : ">"))
      .join("\n");
    return "\n\n" + prefixed + "\n\n";
  }

  // ---------- core traversal ----------

  function serializeChildren(node, depth = 0) {
    let out = "";
    for (const child of Array.from(node.childNodes)) {
      out += serializeNode(child, depth);
    }
    return out;
  }

  function serializeNode(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMd(collapseInline(node.textContent));
    }
    if (node.nodeType === Node.COMMENT_NODE) return "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const el = node;
    const tag = el.tagName.toLowerCase();

    // Math: handled wholesale
    if (MathMod && MathMod.isMathRoot(el)) {
      const md = MathMod.mathElementToMarkdown(el);
      return md !== null ? md : "";
    }
    if (MathMod && MathMod.isMathWrapper(el)) {
      // descend into the wrapper; the inner .katex / mjx-container is intercepted by isMathRoot
      return serializeChildren(el, depth);
    }

    if (isNoise(el)) return "";
    if (isHidden(el)) return "";

    switch (tag) {
      case "br":
        return "\n";
      case "hr":
        return "\n\n---\n\n";
      case "pre":
        return serializePre(el);
      case "blockquote":
        return serializeBlockquote(el);
      case "table":
        return serializeTable(el);
      case "thead":
      case "tbody":
      case "tfoot":
      case "tr":
      case "td":
      case "th":
        // when encountered outside table traversal, just serialize contents
        return serializeChildren(el, depth);
      case "ul":
      case "ol":
        return serializeList(el, depth);
      case "li":
        return serializeChildren(el, depth);
      case "h1": case "h2": case "h3":
      case "h4": case "h5": case "h6": {
        const level = parseInt(tag[1], 10);
        const text = serializeChildren(el, depth).trim().replace(/\n+/g, " ");
        return "\n\n" + "#".repeat(level) + " " + text + "\n\n";
      }
      case "p": {
        const inner = serializeChildren(el, depth);
        if (!inner.trim()) return "";
        // don't add extra wrapping when the paragraph only holds display math
        return "\n\n" + inner.trim() + "\n\n";
      }
      case "strong":
      case "b":
        return applyEmphasis(serializeChildren(el, depth), "**");
      case "em":
      case "i":
        return applyEmphasis(serializeChildren(el, depth), "*");
      case "del":
      case "s":
      case "strike":
        return applyEmphasis(serializeChildren(el, depth), "~~");
      case "code": {
        // pre > code is handled by serializePre; this is inline code
        const text = el.textContent;
        if (!text) return "";
        const fence = text.includes("`") ? "``" : "`";
        const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
        return fence + pad + text + pad + fence;
      }
      case "a": {
        const text = serializeChildren(el, depth).trim();
        const href = el.getAttribute("href") || "";
        if (!href || href.startsWith("javascript:")) return text;
        if (!text) return "";
        // optional title attribute
        const title = el.getAttribute("title");
        return "[" + text + "](" + href + (title ? ' "' + title + '"' : "") + ")";
      }
      case "img": {
        const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
        const alt = el.getAttribute("alt") || "";
        if (!src || src.startsWith("data:image/svg")) return alt ? escapeMd(alt) : "";
        return "![" + alt + "](" + src + ")";
      }
      case "figure": {
        const img = el.querySelector("img");
        const cap = el.querySelector("figcaption");
        let out = "";
        if (img) out += serializeNode(img, depth);
        if (cap) {
          const t = serializeChildren(cap, depth).trim();
          out += "\n\n*" + t + "*";
        }
        return out ? "\n\n" + out + "\n\n" : "";
      }
      case "dl": {
        let out = "";
        for (const child of Array.from(el.children)) {
          const t = child.tagName.toLowerCase();
          if (t === "dt") out += "\n\n**" + serializeChildren(child, depth).trim() + "**";
          else if (t === "dd") out += "\n: " + serializeChildren(child, depth).trim();
        }
        return out + "\n\n";
      }
      default: {
        // block elements: surround with blank lines; inline elements: concatenate directly
        const inner = serializeChildren(el, depth);
        if (isBlock(el)) {
          if (!inner.trim()) return inner;
          return "\n\n" + inner.trim() + "\n\n";
        }
        return inner;
      }
    }
  }

  // ---------- whitespace normalization ----------

  function normalize(md) {
    return (
      md
        // strip trailing whitespace per line
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/, ""))
        .join("\n")
        // collapse 3+ blank lines into one
        .replace(/\n{3,}/g, "\n\n")
        // tidy extra blank lines around $$ math blocks
        .replace(/\n{3,}/g, "\n\n")
        .trim() + "\n"
    );
  }

  // ---------- public API ----------

  // ---------- Range-aware traversal (on the live DOM so getComputedStyle works) ----------

  function nodeEndOffset(node) {
    return node.nodeType === Node.ELEMENT_NODE
      ? node.childNodes.length
      : (node.textContent || "").length;
  }

  /** whether the node (as a whole) intersects the range */
  function intersectsRange(node, range) {
    try {
      const startPos = range.comparePoint(node, 0);
      const endPos = range.comparePoint(node, nodeEndOffset(node));
      // entirely before the range (endPos === -1) or after it (startPos === 1)
      return !(endPos === -1 || startPos === 1);
    } catch (e) {
      return true; // on failure, conservatively assume intersection
    }
  }

  /** whether the node is fully contained in the range */
  function isFullyContained(node, range) {
    try {
      return (
        range.comparePoint(node, 0) === 0 &&
        range.comparePoint(node, nodeEndOffset(node)) === 0
      );
    } catch (e) {
      return false;
    }
  }

  function textInRange(node, range) {
    const full = node.textContent || "";
    const start = range.startContainer === node ? range.startOffset : 0;
    const end = range.endContainer === node ? range.endOffset : full.length;
    return full.slice(Math.min(start, end), Math.max(start, end));
  }

  /**
   * Serialize a node that may be only partially selected:
   * fully contained → serializeNode whole path; partially intersecting → recurse per child with slicing.
   */
  function serializeNodeInRange(node, range, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMd(collapseInline(textInRange(node, range)));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const el = node;

    if (isFullyContained(el, range)) {
      return serializeNode(el, depth);
    }

    const tag = el.tagName.toLowerCase();

    // Math: any overlap outputs the whole formula (half a formula is meaningless)
    if (MathMod && (MathMod.isMathRoot(el) || MathMod.isMathWrapper(el))) {
      return serializeNode(el, depth);
    }
    if (isNoise(el) || isHidden(el)) return "";

    // Code blocks: partial selection outputs the whole block (half a block is rarely wanted)
    if (tag === "pre") return serializePre(el);
    // Tables: filter by row
    if (tag === "table") return serializeTable(el, range);
    // Lists: filter by li
    if (tag === "ul" || tag === "ol") return serializeList(el, depth, range);
    // Blockquotes: recurse into contents, then prefix lines
    if (tag === "blockquote") {
      const inner = serializeChildrenInRange(el, range, depth).trim();
      if (!inner) return "";
      return (
        "\n\n" +
        inner.split("\n").map((l) => (l.length ? "> " + l : ">")).join("\n") +
        "\n\n"
      );
    }
    if (/^h[1-6]$/.test(tag)) {
      const text = serializeChildrenInRange(el, range, depth).trim().replace(/\n+/g, " ");
      return text ? "\n\n" + "#".repeat(+tag[1]) + " " + text + "\n\n" : "";
    }
    if (tag === "strong" || tag === "b")
      return applyEmphasis(serializeChildrenInRange(el, range, depth), "**");
    if (tag === "em" || tag === "i")
      return applyEmphasis(serializeChildrenInRange(el, range, depth), "*");
    if (tag === "del" || tag === "s" || tag === "strike")
      return applyEmphasis(serializeChildrenInRange(el, range, depth), "~~");
    if (tag === "code") {
      const text = rangeTextOfElement(el, range);
      if (!text) return "";
      const fence = text.includes("`") ? "``" : "`";
      const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
      return fence + pad + text + pad + fence;
    }
    if (tag === "a") {
      const text = serializeChildrenInRange(el, range, depth).trim();
      const href = el.getAttribute("href") || "";
      if (!text || !href || href.startsWith("javascript:")) return text;
      return "[" + text + "](" + href + ")";
    }

    const inner = serializeChildrenInRange(el, range, depth);
    if (isBlock(el)) {
      if (!inner.trim()) return "";
      return "\n\n" + inner.trim() + "\n\n";
    }
    return inner;
  }

  /** plain text covered by the range inside a partially selected inline element */
  function rangeTextOfElement(el, range) {
    let text = "";
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (intersectsRange(n, range)) text += textInRange(n, range);
    }
    return text;
  }

  function serializeChildrenInRange(el, range, depth = 0) {
    let out = "";
    for (const child of Array.from(el.childNodes)) {
      if (!intersectsRange(child, range)) continue;
      out += serializeNodeInRange(child, range, depth);
    }
    return out;
  }

  /**
   * Serialize a Range (the user selection).
   * Walks the live DOM along range boundaries so computed styles are available;
   * falls back to cloneContents fragment serialization on failure.
   */
  function serializeRange(range) {
    try {
      const common = range.commonAncestorContainer;
      const root =
        common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
      if (root) {
        const md = serializeNodeInRange(root, range);
        if (md && md.trim()) return normalize(md);
      }
    } catch (err) {
      console.warn("[TeXCopy] live-DOM serialization failed, falling back to fragment:", err);
    }
    // Fallback: detached fragment (isHidden is connection-aware now, so no false positives)
    return normalize(serializeChildren(range.cloneContents()));
  }

  function serializeFragment(fragment) {
    return normalize(serializeChildren(fragment));
  }

  function serializeElement(el) {
    return normalize(serializeNode(el));
  }

  window.CopyAsMarkdownSerializer = {
    serializeRange,
    serializeFragment,
    serializeElement,
    // export internals for testing
    _internal: { escapeMd, collapseInline, normalize, serializeNode, serializeChildren },
  };
})();
