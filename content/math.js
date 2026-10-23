// content/math.js — math recovery module
// Converts KaTeX / MathJax rendered math DOM back to LaTeX source text.
// Exposes global: CopyAsMarkdownMath (used by serializer.js)

(function () {
  "use strict";

  // ---------- MathML → TeX (subset conversion; fallback when MathJax keeps no annotation) ----------

  const GREEK = new Set([
    "alpha","beta","gamma","delta","epsilon","varepsilon","zeta","eta","theta",
    "vartheta","iota","kappa","lambda","mu","nu","xi","pi","varpi","rho",
    "varrho","sigma","varsigma","tau","upsilon","phi","varphi","chi","psi",
    "omega","Gamma","Delta","Theta","Lambda","Xi","Pi","Sigma","Upsilon",
    "Phi","Psi","Omega",
  ]);

  const OPS = {
    "≤": "\\le ", "≥": "\\ge ", "≠": "\\ne ",
    "≈": "\\approx ", "≡": "\\equiv ", "∝": "\\propto ",
    "×": "\\times ", "÷": "\\div ", "±": "\\pm ",
    "∓": "\\mp ", "⋅": "\\cdot ", "∗": "\\ast ",
    "√": "\\sqrt ", "∞": "\\infty ", "∂": "\\partial ",
    "∇": "\\nabla ", "∈": "\\in ", "∉": "\\notin ",
    "⊂": "\\subset ", "⊆": "\\subseteq ", "∪": "\\cup ",
    "∩": "\\cap ", "∅": "\\emptyset ", "∧": "\\wedge ",
    "∨": "\\vee ", "¬": "\\neg ", "⇒": "\\Rightarrow ",
    "→": "\\rightarrow ", "⇐": "\\Leftarrow ", "←": "\\leftarrow ",
    "↔": "\\leftrightarrow ", "≦": "\\leq ", "≧": "\\geq ",
    // big operators (commonly seen in <mo>)
    "∑": "\\sum ", "∏": "\\prod ", "∐": "\\coprod ",
    "∫": "\\int ", "∬": "\\iint ", "∭": "\\iiint ", "∮": "\\oint ",
    "⋀": "\\bigwedge ", "⋁": "\\bigvee ",
    "⋂": "\\bigcap ", "⋃": "\\bigcup ",
    "⨁": "\\bigoplus ", "⨂": "\\bigotimes ",
    "…": "\\dots ", "⋯": "\\cdots ", "⋮": "\\vdots ", "⋱": "\\ddots ",
  };

  const BIG_OPS = new Set([
    "sum","prod","coprod","int","iint","iiint","oint","bigcup","bigcap",
    "bigvee","bigwedge","lim","limsup","liminf","max","min","sup","inf",
  ]);

  function isNumberOrSimple(tok) {
    return /^[\d.]+$/.test(tok) || /^[a-zA-Z]$/.test(tok);
  }

  function needsBraces(tex) {
    const t = tex.trim();
    if (t === "") return false;
    if (isNumberOrSimple(t)) return false;
    // A single command with args (e.g. \frac{..}{..}) needs no braces either (rough check: starts with \, no spaces)
    if (t.startsWith("\\") && !/\s/.test(t)) return false;
    return true;
  }

  function wrapArg(tex) {
    return needsBraces(tex) ? "{" + tex + "}" : tex;
  }

  function mmlChildren(node) {
    return Array.from(node.children);
  }

  function mmlToTex(node) {
    if (!node) return "";
    const tag = node.tagName ? node.tagName.toLowerCase() : "";

    switch (tag) {
      case "math":
      case "semantics":
      case "mrow":
      case "mstyle":
      case "mphantom":
      case "mpadded":
        return mmlChildren(node).map(mmlToTex).join("");

      case "annotation":
        // should not get here (annotations are read first); return empty as a fallback
        return "";

      case "mi":
      case "mn":
      case "mo": {
        let text = node.textContent.trim();
        if (text.length === 0) return "";
        if (GREEK.has(text)) return "\\" + text + " ";
        if (OPS[text] !== undefined) return OPS[text];
        // multi-char mi treated as an identifier (function names etc.)
        if (tag === "mi" && text.length > 1 && !GREEK.has(text)) {
          if (BIG_OPS.has(text)) return "\\" + text + " ";
          return "\\mathrm{" + text + "}";
        }
        if (tag === "mo") {
          if (text === "(" || text === ")" || text === "[" || text === "]" ||
              text === "|" || text === "{" || text === "}") {
            return text === "{" ? "\\{" : text === "}" ? "\\}" : text;
          }
          return text;
        }
        return text;
      }

      case "ms":
        return "\\text{" + node.textContent + "}";

      case "mtext":
        return "\\text{" + node.textContent + "}";

      case "mspace":
        return "\\, ";

      case "msup": {
        const c = mmlChildren(node);
        if (c.length < 2) return "";
        return wrapArg(mmlToTex(c[0])) + "^" + wrapArg(mmlToTex(c[1]));
      }

      case "msub": {
        const c = mmlChildren(node);
        if (c.length < 2) return "";
        return wrapArg(mmlToTex(c[0])) + "_" + wrapArg(mmlToTex(c[1]));
      }

      case "msubsup": {
        const c = mmlChildren(node);
        if (c.length < 3) return "";
        return (
          wrapArg(mmlToTex(c[0])) +
          "_" + wrapArg(mmlToTex(c[1])) +
          "^" + wrapArg(mmlToTex(c[2]))
        );
      }

      case "mfrac": {
        const c = mmlChildren(node);
        if (c.length < 2) return "";
        return "\\frac{" + mmlToTex(c[0]) + "}{" + mmlToTex(c[1]) + "}";
      }

      case "msqrt":
        return "\\sqrt{" + mmlChildren(node).map(mmlToTex).join("") + "}";

      case "mroot": {
        const c = mmlChildren(node);
        if (c.length < 2) return "";
        return "\\sqrt[" + mmlToTex(c[1]) + "]{" + mmlToTex(c[0]) + "}";
      }

      case "mover": {
        const c = mmlChildren(node);
        if (c.length < 2) return "";
        const over = mmlToTex(c[1]).trim();
        const base = mmlToTex(c[0]);
        if (over === "^" || over === "\\^") return "\\hat{" + base + "}";
        if (over === "¯" || over === "-") return "\\overline{" + base + "}";
        if (over === "→" || over === "\\rightarrow ") return "\\vec{" + base + "}";
        if (over === "." || over === "˙") return "\\dot{" + base + "}";
        if (over === "˜") return "\\tilde{" + base + "}";
        return "\\overset{" + over + "}{" + base + "}";
      }

      case "munder": {
        const c = mmlChildren(node);
        if (c.length < 2) return "";
        const base = mmlToTex(c[0]).trim();
        const under = mmlToTex(c[1]);
        if (BIG_OPS.has(base.replace("\\", "").trim())) {
          return base + "_{" + under + "}";
        }
        if (base === "\\underline") return base;
        return "\\underset{" + under + "}{" + base + "}";
      }

      case "munderover": {
        const c = mmlChildren(node);
        if (c.length < 3) return "";
        const base = mmlToTex(c[0]).trim();
        return base + "_{" + mmlToTex(c[1]) + "}^{" + mmlToTex(c[2]) + "}";
      }

      case "mtable": {
        const rows = mmlChildren(node).filter(
          (r) => r.tagName.toLowerCase() === "mtr"
        );
        const lines = rows.map((r) =>
          mmlChildren(r)
            .filter((c) => c.tagName.toLowerCase() === "mtd")
            .map((c) => mmlToTex(c).trim())
            .join(" & ")
        );
        return "\\begin{matrix} " + lines.join(" \\\\ ") + " \\end{matrix}";
      }

      case "mfenced": {
        const open = node.getAttribute("open") ?? "(";
        const close = node.getAttribute("close") ?? ")";
        const sep = node.getAttribute("separators") ?? ",";
        const items = mmlChildren(node)
          .map(mmlToTex)
          .join(sep.trim() ? " " + sep.trim() + " " : "");
        return "\\left" + open + " " + items + " \\right" + close;
      }

      default:
        // unknown tag: best-effort output of children
        return mmlChildren(node).map(mmlToTex).join("") || (node.textContent || "");
    }
  }

  // ---------- KaTeX ----------

  // el: a .katex element (or .katex-display > .katex)
  function katexToLatex(el) {
    // Some sites (e.g. Tencent Yuanbao) strip KaTeX's MathML/annotation layer and
    // keep the original TeX in a data-latex attribute on a wrapper span instead.
    const holder = el.closest && el.closest("[data-latex]");
    if (holder) {
      const v = holder.getAttribute("data-latex");
      if (v && v.trim()) return v.trim();
    }
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    if (ann && ann.textContent.trim()) {
      return ann.textContent.trim();
    }
    // When KaTeX HTML output has no annotation (error cases etc.), fall back to readable text
    const htmlEl = el.querySelector(".katex-html");
    if (htmlEl) return htmlEl.textContent.trim();
    return el.textContent.trim();
  }

  // ---------- MathJax ----------

  function mathjaxToLatex(container) {
    // MathJax v3: prefer an inner TeX annotation (kept by some configurations)
    const ann = container.querySelector(
      'annotation[encoding="application/x-tex"], annotation[encoding="TeX"], annotation[encoding="latex"]'
    );
    if (ann && ann.textContent.trim()) {
      return ann.textContent.trim();
    }
    // Fallback: assistive MathML → TeX subset conversion
    const assistive = container.querySelector("mjx-assistive-mml");
    const mathEl = assistive
      ? assistive.querySelector("math")
      : container.querySelector("math");
    if (mathEl) {
      const tex = mmlToTex(mathEl).trim();
      if (tex) return tex;
    }
    // Next fallback: aria-label often holds the original TeX or a readable form
    const aria = container.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    return container.textContent.trim();
  }

  // ---------- public API ----------

  /**
   * Whether the element is a math root (KaTeX .katex or MathJax mjx-container).
   */
  function isMathRoot(el) {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "mjx-container") return true;
    // Native MathML (Chromium MathML Core): sites may emit raw <math> without KaTeX/MathJax
    if (tag === "math") return true;
    // Site wrappers carrying the original TeX in an attribute (e.g. Yuanbao's
    // <span class="ybc-markdown-katex" data-latex="…">)
    if (el.hasAttribute && el.hasAttribute("data-latex")) return true;
    if (el.classList.contains("katex")) return true;
    // MathJax v2 legacy
    if (el.classList.contains("MathJax") || el.classList.contains("MathJax_SVG")) return true;
    if (el.classList.contains("math")) {
      // some sites wrap the annotation in <span class="math">
      return !!el.querySelector('annotation[encoding="application/x-tex"]');
    }
    return false;
  }

  /**
   * Convert a math root element to LaTeX text for Markdown (wrapped in $ / $$).
   * Returns a string, or null when unrecognized.
   */
  function mathElementToMarkdown(el) {
    let latex = null;
    let display = false;

    const tag = el.tagName.toLowerCase();
    const cls = el.classList;

    // Site wrappers carrying the original TeX in an attribute (e.g. Yuanbao:
    // <span class="ybc-markdown-katex ybc-markdown-katex--display" data-latex="…">).
    // Check first — it's the most direct source when present.
    if (el.hasAttribute && el.hasAttribute("data-latex")) {
      const v = el.getAttribute("data-latex");
      if (v && v.trim()) {
        const className = typeof el.className === "string" ? el.className : "";
        const disp =
          /(^|[\s-])display([\s-]|$)/i.test(className) ||
          className.includes("--display") ||
          !!el.querySelector(".katex-display");
        return wrapLatex(v.trim(), disp);
      }
    }

    if (tag === "mjx-container") {
      latex = mathjaxToLatex(el);
      // MathJax v3 display math: <mjx-container display="true">
      display =
        el.getAttribute("display") === "true" || el.hasAttribute("display");
    } else if (cls.contains("katex")) {
      // .katex-display > .katex structure: display mode determined by the parent
      const parent = el.parentElement;
      display = !!(parent && parent.classList.contains("katex-display"));
      latex = katexToLatex(el);
    } else if (tag === "math") {
      // Native MathML: prefer an embedded TeX annotation, else convert the tree
      const ann = el.querySelector(
        'annotation[encoding="application/x-tex"], annotation[encoding="TeX"]'
      );
      if (ann && ann.textContent.trim()) {
        latex = ann.textContent.trim();
      } else {
        latex = mmlToTex(el).trim();
      }
      display = el.getAttribute("display") === "block";
    } else if (cls.contains("MathJax") || cls.contains("MathJax_SVG")) {
      // MathJax v2
      const script = el.previousElementSibling;
      if (script && script.tagName.toLowerCase() === "script" && script.type === "math/tex") {
        latex = script.textContent.trim();
        display = script.type === "math/tex; mode=display";
      } else {
        const ann = el.querySelector
          ? el.querySelector('annotation[encoding="application/x-tex"]')
          : null;
        if (ann) latex = ann.textContent.trim();
      }
    } else if (cls.contains("math")) {
      const ann = el.querySelector('annotation[encoding="application/x-tex"]');
      if (ann) latex = ann.textContent.trim();
    }

    return wrapLatex(latex, display);
  }

  /** Wrap a LaTeX string for Markdown output ($…$ inline, $$…$$ display). */
  function wrapLatex(latex, display) {
    if (latex == null || latex === "") return null;

    // Strip \[ \] / \( \) wrappers MathJax sometimes keeps
    latex = latex.trim();
    if (!latex) return null;
    if (latex.startsWith("\\[") && latex.endsWith("\\]")) {
      latex = latex.slice(2, -2).trim();
      display = true;
    } else if (latex.startsWith("\\(") && latex.endsWith("\\)")) {
      latex = latex.slice(2, -2).trim();
      display = false;
    }

    if (display) {
      return "\n\n$$\n" + latex + "\n$$\n\n";
    }
    // Inline math: if it contains $, \(..\) is safer
    if (latex.includes("$")) {
      return "\\(" + latex + "\\)";
    }
    return "$" + latex + "$";
  }

  /**
   * Whether an element is a math "outer wrapper" (.katex-display, MathJax_SVG_Display etc.).
   * The serializer should descend into these wrappers to reach the real math root.
   */
  function isMathWrapper(el) {
    if (!(el instanceof Element)) return false;
    const cls = el.classList;
    return (
      cls.contains("katex-display") ||
      cls.contains("MathJax_SVG_Display") ||
      cls.contains("MathJax_Display")
    );
  }

  window.CopyAsMarkdownMath = {
    isMathRoot,
    isMathWrapper,
    mathElementToMarkdown,
    mmlToTex, // exported for testing
  };
})();
