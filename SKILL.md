---
name: render-markdown
description: Render a local markdown file to a small styled HTML page and open it in the browser. Use whenever the user wants to preview a markdown file (handoff doc, README, design note, planning checklist, anything with YAML frontmatter or GFM task-list checkboxes) without launching a dev server or a heavy editor. Triggers on phrases like "open this in html", "preview this md", "render the markdown", "open the doc as a webpage", "render and open", "open the handoff in html", "view this md in browser".
---

# Render markdown

Turns a markdown file on disk into a small styled HTML page and opens it
in the user's default browser. Built for the moment someone wants to *look*
at a doc they just wrote, not edit it.

## When to use

Use this whenever the user asks to "open in html", "preview the md",
"render this doc", "open as a webpage", or similar — including cases where
the user types something short like "open again" after we've previewed a
file once already. Also reach for it after writing a planning doc,
handoff, or checklist on the user's behalf — offering a one-line preview
is usually appreciated.

Don't reach for this if the user wants to publish the output, embed it in
something, or needs precise typography. This is a quick-look tool.

## How

Run the bundled script. It strips YAML frontmatter (so `marked` doesn't
promote it to a giant heading via setext rules), renders the body with
GFM and footnotes enabled, and writes a self-contained HTML page with a
warm-paper light theme, matched dark theme (system / forced via the
top-right toggle), and a minimal sun/monitor/moon switcher that persists
in `localStorage`. ` ```mermaid ` fenced blocks render as real diagrams
via the Mermaid ESM bundle (CDN, loaded only when a mermaid block is
present).

```bash
bun run ~/.claude/skills/render-markdown/scripts/render-md.ts <input.md> [out.html]
open <out.html>
```

Default output path is `/tmp/preview.html`. The script prints the output
path on stdout so you can pipe it: `OUT=$(bun run … input.md) && open $OUT`.

### File layout

The script is split across four files in `scripts/`, inlined at render
time so the output stays a single self-contained HTML page:

| File | Role |
|---|---|
| `render-md.ts` | Markdown → HTML assembly. Handles frontmatter, marked config, output. |
| `styles.css` | All CSS — design tokens, light/dark themes, code, tables, footnotes, toggle. |
| `theme-toggle.html` | Sun / monitor / moon toggle markup + persistence script. |
| `mermaid-init.js` | Mermaid bootstrap with theme-aware initialization. |

The three non-TS files are read via bun's `import x from "./foo.ext"
with { type: "text" }` syntax. Edit any one concern in isolation; no
build step. If you change `styles.css`, just re-run the script — no
recompile needed.

Design tokens follow the `prose-typography` skill: 680px measure,
16px/1.6 body, h2 with 2.6em top margin, borders and inline-code
backgrounds derived from the text color at low alpha so the surface
themes coherently in both modes.

## Conventions

- Default to `/tmp/preview.html` unless the user names a different
  destination. Overwriting is fine — this is throwaway preview output.
- After opening, give a one-line confirmation (what file you rendered,
  where it landed). Don't dump the HTML contents.
- If the user iterates on the source file and asks to "open again", just
  re-run the script and re-`open` — the path stays stable so the existing
  browser tab refreshes.

## Why a script instead of inline rendering

The frontmatter quirk (setext heading promotion when `---` follows
key/value lines) is the kind of thing that bites every time someone
reimplements this inline with `marked`. Bundling the script means we fix
it once. The design tokens, dark mode, theme toggle, footnote handling,
syntax highlighting, mermaid wiring, and table/checkbox styling also
stay consistent across previews.

## Dependencies

- `bun` on PATH. The script imports `marked`, `marked-footnote`, and
  `highlight.js` — bun auto-installs them on first run, or reads from
  the local `node_modules` of whatever directory you `bun run` from.
  `import … with { type: "text" }` for the adjacent CSS/HTML/JS files
  requires bun ≥ 1.1.
- `open` (macOS) — on Linux substitute `xdg-open`, on Windows `start`.
- Network on first render of a doc containing mermaid (CDN-loaded
  Mermaid ESM bundle). Re-renders cache the bundle in the browser.
