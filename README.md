# render-markdown

Why choose between markdown and HTML when you can render markdown in HTML? This skill lets your local coding agents render your markdown files with a rich preview + a live CodeMirror editor. Supports task lists, footnotes, mermaid and more. Install the skill and type `/render-markdown`.

## Install

```bash
npx skills add smithery-ai/render-markdown
```

## Two modes

- **One-shot preview**: render once to `/tmp/preview.html` and open it in the browser. Static, self-contained file.
- **Live editor**: spin up a tiny local server with a CodeMirror editor (read mode + raw mode, `Cmd-E` to toggle). Edits autosave to the source file; the preview hot-reloads.

## How it works

```
input.md ──▶ marked + hljs + mermaid ──┬──▶ /tmp/preview.html   (one-shot, open in browser)
                                       └──▶ localhost:7780      (live, CodeMirror editor)
```

- Footnotes, GFM task lists, tables, mermaid diagrams, syntax-highlighted code
- Warm light + warm dark themes, sun/system/moon toggle (persists in localStorage)
- Single self-contained HTML output in one-shot mode

## Contributing

[Open an issue](https://github.com/smithery-ai/render-markdown/issues) or send a PR.
