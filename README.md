<p align="center">
  <img src="assets/banner.svg" width="720" alt="TeXCopy — Copy AI answers as clean Markdown"/>
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-2563eb?style=flat-square"/>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Chromium-success?style=flat-square"/>
  <img alt="Dependencies" src="https://img.shields.io/badge/dependencies-zero-brightgreen?style=flat-square"/>
  <img alt="Tests" src="https://img.shields.io/badge/tests-18_passing-brightgreen?style=flat-square"/>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"/>
</p>

<p align="center">
  <strong>English</strong> · <a href="#中文说明">中文</a>
</p>

---

Ever tried copying an AI answer with math in it — and got `x=−b±√b2−4ac2a` garbage instead of the formula? Or lost every heading, code fence and table on the way?

**TeXCopy** fixes that. Select any content on any page, right-click → **Copy as Markdown**, and get faithful, clean Markdown in your clipboard:

- 🧮 **Math preserved as LaTeX** — KaTeX formulas are recovered *losslessly* from their embedded source annotations; MathJax falls back to a MathML→TeX converter. Inline `$…$`, display `$$…$$`.
- 💻 **Real code blocks** — fenced, with language tags, no line-number or UI garbage.
- 📋 **Full structure** — headings, bold/italic, nested lists, GFM tables, blockquotes, links, horizontal rules.
- 🧹 **Noise filtered out** — copy/like/regenerate buttons, toolbars, `aria-hidden` widgets never make it into your clipboard.
- ✂️ **Partial selection works** — select half a sentence, half a table or part of a list: only what you selected is copied (formulas and code blocks stay whole, because half a formula is meaningless).
- 🔒 **Zero page intrusion** — TeXCopy never touches `Ctrl+C`. It only runs when *you* click the context-menu item.

<p align="center">
  <img src="assets/demo.svg" width="820" alt="Demo: select an AI answer, right-click Copy as Markdown, paste clean Markdown"/>
</p>

## Before / After

| What you see on the page | What native copy gives you | What TeXCopy gives you |
|---|---|---|
| Rendered fraction | `x=−b±√b2−4ac2a` | `$$x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$$` |
| Python code block | flattened one-liner with UI text | ` ```python … ``` ` with newlines intact |
| Comparison table | tab-separated mush | proper GFM pipe table |
| Headings & lists | plain lines | `##`, `-`, `1.` markers preserved |

## Install

TeXCopy is not on the Chrome Web Store (yet) — load it unpacked, it takes 20 seconds:

```bash
git clone https://github.com/Misa-XU/texcopy.git
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `texcopy` folder
4. Done — no configuration, no sign-in.

> Works in any Chromium browser: Chrome, Edge, Brave, Arc, Opera…

## Usage

1. Select content on any page (an AI answer, a blog post, docs…)
2. Right-click → **Copy as Markdown**
3. Paste anywhere. A green toast confirms success.

**Where it shines:** ChatGPT · Claude · Tencent Yuanbao (元宝) · Kimi · DeepSeek · Gemini · Zhihu · CSDN · Juejin · any site rendering KaTeX/MathJax — and honestly, any HTML page.

## How it works

```mermaid
flowchart LR
    A["Context menu<br/>(selection)"] --> B["background.js<br/>service worker"]
    B -->|"ensure content script<br/>(inject on demand)"| C["content script"]
    C --> D["serializer.js<br/>range-aware DOM walk"]
    D --> E["math.js<br/>KaTeX / MathJax → LaTeX"]
    D --> F["Markdown string"]
    F --> G{"clipboard<br/>write in page"}
    G -->|ok| H["✓ toast"]
    G -->|denied<br/>(no user gesture)| I["offscreen document<br/>extension clipboard"]
    I --> H
```

Key engineering decisions:

- **Live-DOM range walking.** Instead of `Range.cloneContents()` (detached nodes have no layout or computed styles — a classic source of subtle bugs), the serializer walks the *live* DOM along the range boundaries using `comparePoint`, slicing text nodes at the exact selection offsets.
- **Lossless math for KaTeX.** KaTeX embeds the original TeX in `<annotation encoding="application/x-tex">`; TeXCopy reads it back verbatim. For MathJax without annotations, a subset MathML→TeX converter handles fractions, sub/superscripts, roots, big operators, Greek letters and more — with graceful fallbacks so content is never silently lost.
- **Three-tier clipboard strategy.** A context-menu click grants no user gesture to the page, so `navigator.clipboard` may be denied. TeXCopy falls back to `execCommand`, then to an MV3 **offscreen document** holding the extension's own clipboard permission — the most reliable channel.
- **On-demand injection.** Pages opened before the extension was installed get the content script injected via `chrome.scripting` (authorized by `activeTab` from the menu click). No refresh needed.

## Project layout

```
├── manifest.json        # MV3 manifest
├── background.js        # context menu, on-demand injection, offscreen fallback
├── offscreen.html/js    # reliable clipboard channel (no user gesture needed)
├── content/
│   ├── main.js          # message entry: selection → serialize → clipboard → toast
│   ├── serializer.js    # range-aware DOM → Markdown walker (zero deps)
│   ├── math.js          # KaTeX / MathJax → LaTeX recovery
│   └── clipboard.js     # in-page clipboard write with fallbacks
├── assets/              # banner + animated demo (SVG)
├── icons/               # generated by tools/gen_icons.js
└── test/
    ├── run_tests.js     # jsdom test suite (18 tests)
    └── test_page.html   # manual browser test page (KaTeX via CDN)
```

## Development

No build step. No dependencies at runtime.

```bash
# run the test suite (jsdom)
cd test && npm install jsdom --no-audit   # first time only
node test/run_tests.js                    # from repo root

# regenerate icons
node tools/gen_icons.js

# manual browser test: open test/test_page.html and follow the yellow banner
```

## Roadmap

- [ ] Rich-text (HTML) clipboard output alongside Markdown
- [ ] Popup with per-site preferences
- [ ] Copy a whole AI message with one click (no selection needed)
- [ ] Firefox port
- [ ] Chrome Web Store listing

## License

[MIT](LICENSE)

---

<a id="中文说明"></a>
# 中文说明

<p align="center">
  <a href="#top">English</a> · <strong>中文</strong>
</p>

在 AI 聊天页面复制带公式的回答，粘贴出来经常是 `x=−b±√b2−4ac2a` 这样的乱码，标题、代码块、表格也全丢了格式。

**TeXCopy（复制增强器）**解决这个问题：在任意网页选中内容 → 右键 → **Copy as Markdown**，剪贴板里就是干净、忠实的 Markdown：

- 🧮 **公式无损还原为 LaTeX**——KaTeX 直接从内嵌源码注解读取（元宝 / ChatGPT / Claude / Kimi 等）；MathJax 走 MathML→TeX 子集转换（DeepSeek 等）。行内 `$…$`，块级 `$$…$$`
- 💻 **代码块**带语言标记的围栏形式，无行号、无按钮文字混入
- 📋 **完整结构**：标题、加粗/斜体、嵌套列表、GFM 表格、引用、链接、分隔线
- 🧹 **自动过滤噪音**：复制/点赞/重新生成按钮、工具条、`aria-hidden` 元素统统不进剪贴板
- ✂️ **支持部分选中**：选中半句话、半个表格、列表的一部分，只输出选区内容（公式和代码块保持完整——半个公式没有意义）
- 🔒 **对页面零侵入**：不拦截 `Ctrl+C`，只在你主动点击右键菜单时工作

## 安装

暂未上架 Chrome 应用商店，本地加载只需 20 秒：

1. 克隆或下载本仓库
2. 打开 `chrome://extensions`，开启右上角**开发者模式**
3. 点击**加载已解压的扩展程序**，选择仓库根目录
4. 完成，无需任何配置

> 适用于所有 Chromium 系浏览器：Chrome、Edge、Brave、Arc、Opera……

## 使用

选中网页内容 → 右键 → **Copy as Markdown** → 到任意地方粘贴，右下角绿色提示表示成功。

**最佳场景**：元宝、ChatGPT、Claude、Kimi、DeepSeek、Gemini、知乎、CSDN、掘金等一切渲染 KaTeX/MathJax 的页面——以及任何普通 HTML 页面。

## 技术要点

- **活 DOM 按选区遍历**：不用 `cloneContents()`（克隆节点没有布局和计算样式，是一类经典 bug 的根源），而是用 `comparePoint` 沿选区边界在活 DOM 上遍历，文本节点按选区偏移精确切片
- **三级剪贴板保障**：页面内 `navigator.clipboard` → `execCommand` 降级 → MV3 **offscreen document**（持扩展自身剪贴板权限，无需用户手势，最可靠）
- **按需注入**：装扩展前已打开的页面，通过 `chrome.scripting` + `activeTab`（由菜单点击授权）即时注入，无需刷新

## 开发

无构建步骤，运行时零依赖。

```bash
cd test && npm install jsdom --no-audit   # 仅首次
node test/run_tests.js                    # 仓库根目录运行，18 项测试
node tools/gen_icons.js                   # 重新生成图标
# 手动测试：浏览器打开 test/test_page.html，按页面顶部黄色提示操作
```

## 路线图

- [ ] 剪贴板同时写入富文本（HTML）格式
- [ ] Popup 设置界面（按站点开关）
- [ ] 一键复制整条 AI 消息（免选中）
- [ ] Firefox 版本
- [ ] 上架 Chrome 应用商店

## 许可证

[MIT](LICENSE)
