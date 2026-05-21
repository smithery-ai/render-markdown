# render-markdown

Your handoff docs, READMEs, planning checklists, and design notes deserve to look good when you read them back. This skill renders a local markdown file to a small styled HTML page and opens it in the browser — no dev server, no editor, no Notion paste. Typography tuned against Linear, Notion, Stripe Docs, and Vercel/Geist (concrete tokens, not vibes).

## Install

```bash
npx skills add smithery-ai/render-markdown
```

Then ask Claude to "preview this md" / "open the handoff in html" / "render the doc", or invoke `/render-markdown` directly.

## How it works

```
  input.md ──┬─▶ strip YAML frontmatter (avoids setext-heading promotion)
             │
             ├─▶ marked + marked-footnote + GFM
             │
             ├─▶ highlight.js (syntax-highlighted code blocks)
             │
             ├─▶ ```mermaid blocks ──▶ Mermaid ESM (CDN, lazy)
             │
             ▼
       /tmp/preview.html  ──▶  open in default browser
       (single self-contained file: CSS, theme toggle, mermaid bootstrap all inlined)
```

- **Typography**: 16px/1.6 body, 680px measure, h2 margin-top 2.6em, headings with size-dependent negative tracking (-0.012em at 20px → -0.022em at 32px+). Borders and inline-code backgrounds derived from text color at low alpha so the whole surface themes coherently.
- **Themes**: warm-paper light (`#fbf8f3` / `#1c1814`) and warm dark (`#14110d` / `#ede4d3`). Sun / monitor / moon toggle top-right, choice persists in `localStorage`, defaults to system.
- **Code**: hljs syntax highlighting on a dark code-block surface. Inline code uses an alpha-of-text background so it doesn't fight the page.
- **Mermaid**: ` ```mermaid ` fenced blocks render as real diagrams, theme-aware (initializes with `theme: "dark"` when dark mode is active).
- **Footnotes**: `[^1]` style renders as a proper footnotes section at the bottom via `marked-footnote`.
- **Frontmatter**: YAML frontmatter at the top of the source is shown as a compact muted callout instead of being promoted to a giant heading.

## Layout

```
SKILL.md                       Claude-facing trigger phrases + usage
scripts/
├── render-md.ts               Markdown → HTML assembly
├── styles.css                 Design tokens, light/dark, all CSS
├── theme-toggle.html          Sun/monitor/moon toggle + persistence
└── mermaid-init.js            Theme-aware mermaid bootstrap
```

The three non-TS files are inlined into the output HTML at render time via bun's `import x from "./foo.ext" with { type: "text" }` syntax. The rendered page is a single self-contained file (only the Mermaid CDN is fetched, and only when a doc contains mermaid).

## Dependencies

- [`bun`](https://bun.sh) ≥ 1.1 — runs the script and auto-installs `marked`, `marked-footnote`, `highlight.js` on first run.
- `open` (macOS) — substitute `xdg-open` on Linux or `start` on Windows.

## Design rationale

Tokens come from production CSS of Linear, Notion, Stripe Docs, and Vercel/Geist (inspected May 2026). The full diagnostic checklist and reference tables live in a sibling [`prose-typography`](https://github.com/smithery-ai/prose-typography) skill (TBD).

## Contributing

Found a bug or have an idea? [Open an issue](https://github.com/smithery-ai/render-markdown/issues) or submit a pull request.
