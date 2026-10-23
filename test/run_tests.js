// test/run_tests.js — jsdom-based automated tests for the serializer and math modules
// Usage: node test/run_tests.js

"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const mathSrc = fs.readFileSync(path.join(ROOT, "content/math.js"), "utf8");
const serializerSrc = fs.readFileSync(path.join(ROOT, "content/serializer.js"), "utf8");

let passed = 0;
let failed = 0;

function makeDom(bodyHtml) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body><div id="content">${bodyHtml}</div></body></html>`,
    { runScripts: "outside-only" }
  );
  const { window } = dom;
  // NOTE: getClientRects is intentionally NOT stubbed — real jsdom returns an empty
  // array, which verifies the serializer never treats elements as hidden just
  // because layout info is missing (the old cloneContents bug).
  window.eval(mathSrc);
  window.eval(serializerSrc);
  return window;
}

function mdOf(html) {
  const window = makeDom(html);
  const el = window.document.getElementById("content");
  return window.CopyAsMarkdownSerializer.serializeElement(el).trim();
}

function runAssertions(md, assertions) {
  const problems = [];
  for (const a of assertions) {
    if (a.not) {
      if (md.includes(a.has)) problems.push(`should NOT contain "${a.has}"`);
    } else if (a.equals !== undefined) {
      if (md !== a.equals) problems.push(`expected:\n${JSON.stringify(a.equals)}\nactual:\n${JSON.stringify(md)}`);
    } else {
      if (!md.includes(a.has)) problems.push(`missing "${a.has}"`);
    }
  }
  return problems;
}

function check(name, html, assertions) {
  let md;
  try {
    md = mdOf(html);
  } catch (err) {
    console.error(`✗ ${name}\n  threw: ${err.stack}`);
    failed++;
    return;
  }
  const problems = runAssertions(md, assertions);
  if (problems.length === 0) {
    console.log(`✓ ${name}`);
    passed++;
  } else {
    console.error(`✗ ${name}\n  ${problems.join("\n  ")}\n  ---- actual ----\n${md}\n  ----------------`);
    failed++;
  }
}

// ---------- KaTeX ----------

const katexInline = `
<p>The mass-energy relation <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span><span class="katex-html"><span class="base"><span class="mord">E=mc2</span></span></span></span> is famous.</p>`;

check("KaTeX inline math → $...$", katexInline, [
  { has: "$E = mc^2$" },
  { not: { has: "E=mc2" } }, // rendered katex-html noise must not leak
]);

const katexDisplay = `
<div class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>x</mi><mo>=</mo><mfrac><mrow><mo>−</mo><mi>b</mi><mo>±</mo><msqrt><mrow><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></mrow></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac></mrow><annotation encoding="application/x-tex">x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}</annotation></semantics></math></span><span class="katex-html">…</span></span></div>`;

check("KaTeX display math → $$...$$", katexDisplay, [
  { has: "$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$" },
]);

// ---------- MathJax ----------

const mathjaxAnnotation = `
<p>Let <mjx-container class="MathJax" jax="SVG"><mjx-assistive-mml><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><annotation encoding="application/x-tex">a+b</annotation></semantics></math></mjx-assistive-mml></mjx-container> hold.</p>`;

check("MathJax with TeX annotation → $...$", mathjaxAnnotation, [
  { has: "$a+b$" },
]);

const mathjaxMmlOnly = `
<div><mjx-container class="MathJax" jax="SVG" display="true"><mjx-assistive-mml><math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>y</mi><mo>=</mo><mfrac><mn>1</mn><mi>x</mi></mfrac><mo>+</mo><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msqrt><mn>2</mn></msqrt><mo>+</mo><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msub><mi>a</mi><mi>i</mi></msub></mrow></math></mjx-assistive-mml></mjx-container></div>`;

check("MathJax MathML-only → subset MathML→TeX conversion", mathjaxMmlOnly, [
  { has: "\\frac{1}{x}" },
  { has: "x^2" },
  { has: "\\sqrt{2}" },
  { has: "\\sum_{i=1}^{n}" },
  { has: "a_i" },
  { has: "$$" }, // display container
]);

// ---------- regular Markdown ----------

check("headings / bold / italic / inline code / links", `
<h2>Section heading</h2>
<p>This is <strong>bold</strong>, <em>italic</em>, <code>inline_code()</code> and a <a href="https://example.com" title="Example">link label</a>.</p>`, [
  { has: "## Section heading" },
  { has: "**bold**" },
  { has: "*italic*" },
  { has: "`inline_code()`" },
  { has: '[link label](https://example.com "Example")' },
]);

check("fenced code block with language tag", `
<pre><code class="language-python">def f(x):
    return x ** 2</code></pre>`, [
  { has: "```python\ndef f(x):\n    return x ** 2\n```" },
]);

check("code containing ``` upgrades to a 4-backtick fence", `
<pre><code class="lang-js">const s = \`\`\`template\`\`\`;</code></pre>`, [
  { has: "````js" },
]);

check("layout <pre> wrapper (rich content inside) is NOT fenced as one code block", `
<pre class="msg-content"><h3>Title</h3><p>Para with <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">a^2</annotation></semantics></math></span><span class="katex-html">a2</span></span> math.</p><ul><li>item</li></ul><pre><code class="language-js">real_code();</code></pre></pre>`, [
  { has: "### Title" },
  { has: "Para with $a^2$ math." },
  { has: "- item" },
  { has: "```js\nreal_code();\n```" }, // the nested REAL code block still fenced
]);

check("plain <pre> without <code> child is still a code block", `
<pre>line one
line two</pre>`, [
  { has: "```\nline one\nline two\n```" },
]);

check("nested unordered/ordered lists (with start offset)", `
<ul>
  <li>First item</li>
  <li>Second item
    <ol start="3">
      <li>Sub-item A</li>
      <li>Sub-item B</li>
    </ol>
  </li>
</ul>`, [
  { has: "- First item" },
  { has: "- Second item" },
  { has: "  3. Sub-item A" },
  { has: "  4. Sub-item B" },
]);

check("GFM table with escaped pipes", `
<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>a|b</td><td>1</td></tr><tr><td>c</td><td>2</td></tr></tbody></table>`, [
  { has: "| Name | Value |" },
  { has: "| --- | --- |" },
  { has: "| a\\|b | 1 |" },
]);

check("blockquote", `
<blockquote><p>Quoted line one</p><p>Quoted line two</p></blockquote>`, [
  { has: "> Quoted line one" },
  { has: "> Quoted line two" },
]);

check("noise filtering: buttons / svg / aria-hidden are dropped", `
<p>Body text</p>
<button class="copy-btn">Copy</button>
<div aria-hidden="true">hidden toolbar</div>
<svg width="10"><path d="M0 0"/></svg>`, [
  { has: "Body text" },
  { not: { has: "Copy" } },
  { not: { has: "hidden toolbar" } },
]);

check("horizontal rule", `<p>above</p><hr><p>below</p>`, [
  { has: "above\n\n---\n\nbelow" },
]);

check("Markdown special characters in plain text are escaped", `
<p>Compute 100*2 [note] _emphasis_ without triggering formatting</p>`, [
  { has: "100\\*2" },
  { has: "\\[note\\]" },
  { has: "\\_emphasis\\_" },
]);

check("mixed AI answer: heading + math + code + table + list", `
<h3>Solution</h3>
<p>By the quadratic formula <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">x=\\frac{-b}{2a}</annotation></semantics></math></span><span class="katex-html">x=−b2a</span></span> we get:</p>
<ul><li>the discriminant <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">\\Delta = b^2-4ac</annotation></semantics></math></span><span class="katex-html">Δ=b2−4ac</span></span></li></ul>
<pre><code class="language-python">delta = b*b - 4*a*c</code></pre>
<table><thead><tr><th>Δ</th><th>Roots</th></tr></thead><tbody><tr><td>&gt;0</td><td>two real roots</td></tr></tbody></table>`, [
  { has: "### Solution" },
  { has: "$x=\\frac{-b}{2a}$" },
  { has: "- the discriminant $\\Delta = b^2-4ac$" },
  { has: "```python\ndelta = b*b - 4*a*c\n```" },
  { has: "| Δ | Roots |" },
  { not: { has: "Δ=b2−4ac" } },
]);

// ---------- Tencent Yuanbao style (data-latex attribute, no annotation layer) ----------

// Real-world structure captured from yuanbao.tencent.com:
// display math wrapped in <pre class="ybc-pre-component">, KaTeX without the
// MathML/annotation layer, original TeX kept in data-latex on the wrapper span.
check("Yuanbao display math: <pre> wrapper + data-latex → $$...$$ (not a code fence)", `
<pre class="ybc-pre-component"><span class="ybc-markdown-katex ybc-markdown-katex--display" data-latex="H^{(0)} \\in \\mathbb{R}^{n\\times d}"><span class="katex-display"><span class="katex"><span class="katex-html" aria-hidden="true"><span class="base"><span class="mord">H(0)∈Rn×d</span></span></span></span></span></span></pre>`, [
  { has: "$$\nH^{(0)} \\in \\mathbb{R}^{n\\times d}\n$$" },
  { not: { has: "```" } },
  { not: { has: "H(0)∈Rn×d" } },
]);

check("Yuanbao inline math: data-latex without --display → $...$", `
<p>Hidden state <span class="ybc-markdown-katex" data-latex="H^{(0)}"><span class="katex"><span class="katex-html" aria-hidden="true"><span class="base">H(0)</span></span></span></span> is initialized.</p>`, [
  { has: "$H^{(0)}$" },
  { not: { has: "H(0)" } },
]);

check("Yuanbao custom list: decorative bullet spans dropped, content div unwrapped", `
<ul class="ybc-ul-component"><li class="ybc-li-component ybc-li-component_ul"><span class="ybc-li-component__dot-wp"><span class="ybc-li-component_dot">•</span></span><span class="ybc-li-component_content"><div class="ybc-p">content–content</div>
</span></li><li class="ybc-li-component ybc-li-component_ul"><span class="ybc-li-component__dot-wp"><span class="ybc-li-component_dot">•</span></span><span class="ybc-li-component_content"><div class="ybc-p">content–position</div>
</span></li><li class="ybc-li-component ybc-li-component_ul"><span class="ybc-li-component__dot-wp"><span class="ybc-li-component_dot">•</span></span><span class="ybc-li-component_content"><div class="ybc-p">position–position</div>
</span></li></ul>`, [
  { equals: "- content–content\n- content–position\n- position–position" },
]);

check("KaTeX without annotation picks up data-latex from ancestor wrapper", `
<span data-latex="\\alpha + \\beta"><span class="katex"><span class="katex-html" aria-hidden="true"><span class="base">α+β</span></span></span></span>`, [
  { has: "$\\alpha + \\beta$" },
]);

// ---------- native MathML & Shadow DOM ----------

check("Native MathML (Chromium MathML Core) → $...$", `
<p>Let <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>a</mi><mo>+</mo><mfrac><mi>b</mi><mn>2</mn></mfrac></math> be positive.</p>`, [
  { has: "$a+\\frac{b}{2}$" },
]);

check("Native MathML with display=block → $$...$$", `
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><msup><mi>x</mi><mn>2</mn></msup></math>`, [
  { has: "$$\nx^2\n$$" },
]);

check("Native MathML prefers embedded TeX annotation", `
<p><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><msup><mi>x</mi><mn>2</mn></msup><annotation encoding="application/x-tex">x^{2}</annotation></semantics></math></p>`, [
  { has: "$x^{2}$" },
]);

// Shadow DOM needs manual DOM setup, so it gets its own block instead of check()
(function shadowDomTest() {
  const name = "open Shadow DOM content is serialized";
  try {
    const window = makeDom('<div id="host"></div>');
    const doc = window.document;
    const host = doc.getElementById("host");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<p>shadow <strong>content</strong> with <code>code()</code></p>";
    const md = window.CopyAsMarkdownSerializer.serializeElement(host).trim();
    if (md.includes("shadow **content** with `code()`")) {
      console.log(`✓ ${name}`);
      passed++;
    } else {
      console.error(`✗ ${name}\n  ---- actual ----\n${md}\n  ----------------`);
      failed++;
    }
  } catch (err) {
    console.error(`✗ ${name}\n  threw: ${err.stack}`);
    failed++;
  }
})();

// ---------- Range (selection) serialization ----------

function checkRange(name, html, setupRange, assertions) {
  let md;
  try {
    const window = makeDom(html);
    const doc = window.document;
    const range = doc.createRange();
    setupRange(range, doc, window);
    md = window.CopyAsMarkdownSerializer.serializeRange(range).trim();
  } catch (err) {
    console.error(`✗ ${name}\n  threw: ${err.stack}`);
    failed++;
    return;
  }
  const problems = runAssertions(md, assertions);
  if (problems.length === 0) {
    console.log(`✓ ${name}`);
    passed++;
  } else {
    console.error(`✗ ${name}\n  ${problems.join("\n  ")}\n  ---- actual ----\n${md}\n  ----------------`);
    failed++;
  }
}

function selectAll(range, doc) {
  const content = doc.getElementById("content");
  range.setStart(content, 0);
  range.setEnd(content, content.childNodes.length);
}

const katex = (tex, display) =>
  (display ? '<div class="katex-display">' : "") +
  `<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow></mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html">RENDERED_NOISE</span></span>` +
  (display ? "</div>" : "");

checkRange(
  "Range select-all: block structure survives (regression: cloneContents hidden-misdetection bug)",
  `<h2>Heading A</h2>
   <p>Paragraph one ${katex("a^2+b^2=c^2")} Pythagoras</p>
   ${katex("x=\\frac{1}{2}", true)}
   <pre><code class="language-js">const a = 1;\nconst b = 2;</code></pre>
   <table><thead><tr><th>Col1</th><th>Col2</th></tr></thead><tbody><tr><td>v1</td><td>v2</td></tr></tbody></table>
   <ul><li>Item one</li><li>Item two</li></ul>
   <button class="copy-btn">Copy</button>`,
  selectAll,
  [
    { has: "## Heading A" },
    { has: "$a^2+b^2=c^2$" },
    { has: "$$\nx=\\frac{1}{2}\n$$" },
    { has: "```js\nconst a = 1;\nconst b = 2;\n```" },
    { has: "| Col1 | Col2 |" },
    { has: "| v1 | v2 |" },
    { has: "- Item one" },
    { has: "- Item two" },
    { not: { has: "RENDERED_NOISE" } },
    { not: { has: "Copy" } },
  ]
);

checkRange(
  "Partial Range: only the selected slice is emitted (truncated text + inline elements)",
  `<p>HEADpart <strong>world selected bold</strong> middle ${katex("E=mc^2")} TAILpart</p>`,
  (range, doc) => {
    const p = doc.querySelector("p");
    // select from offset 5 of the first text node to offset 1 of the last text node
    const firstText = p.childNodes[0];
    const lastText = p.childNodes[p.childNodes.length - 1];
    range.setStart(firstText, 5);
    range.setEnd(lastText, 1);
  },
  [
    { has: "**world selected bold**" },
    { has: "$E=mc^2$" },
    { not: { has: "HEAD" } },
    { not: { has: "TAILpart" } },
  ]
);

checkRange(
  "Cross-block Range: multiple paragraphs and lists, separated by blank lines",
  `<p>First paragraph</p><p>Second paragraph</p><ul><li>A</li><li>B</li></ul><p>Third paragraph</p>`,
  selectAll,
  [
    { has: "First paragraph\n\nSecond paragraph" },
    { has: "- A" },
    { has: "- B" },
    { has: "Third paragraph" },
  ]
);

checkRange(
  "Partial table Range: only intersecting rows are emitted",
  `<table><tbody><tr><td>r1c1</td><td>r1c2</td></tr><tr><td>r2c1</td><td>r2c2</td></tr><tr><td>r3c1</td><td>r3c2</td></tr></tbody></table>`,
  (range, doc) => {
    const rows = doc.querySelectorAll("tr");
    range.setStartBefore(rows[0]);
    range.setEndAfter(rows[1]);
  },
  [
    { has: "r1c1" },
    { has: "r2c2" },
    { not: { has: "r3c1" } },
  ]
);

// ---------- summary ----------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
