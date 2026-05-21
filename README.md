# render-markdown

Render a local markdown file to a polished HTML preview and open it in the browser. Typography tuned against Linear, Notion, and Stripe Docs.

## Install

```bash
npx skills add smithery-ai/render-markdown
```

Then ask Claude to "preview this md" or "open the handoff in html".

## How it works

```
  input.md ──▶ strip frontmatter ──▶ marked + GFM + footnotes ──▶ /tmp/preview.html ──▶ open
                                     highlight.js
                                     ```mermaid (CDN, lazy)
```

- Warm light + warm dark themes, sun/monitor/moon toggle (persists in localStorage)
- 680px measure, 16px/1.6 body, size-dependent heading tracking, alpha-of-text borders
- Footnotes, GFM task lists, tables, mermaid diagrams, syntax-highlighted code
- Single self-contained HTML output

## Contributing

[Open an issue](https://github.com/smithery-ai/render-markdown/issues) or send a PR.
