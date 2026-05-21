---
name: render-markdown
description: Render a local markdown file to a styled HTML page — either one-shot (static file, open in browser) or as a live CodeMirror editor on a local server with read/raw mode toggle and autosave. Use whenever the user wants to preview a markdown file (handoff doc, README, design note, planning checklist, anything with YAML frontmatter or GFM task-list checkboxes) without launching a dev server or a heavy editor. Use the server mode when the user wants to iterate on the source live, switch between rendered and raw, or share a localhost preview. Triggers on phrases like "open this in html", "preview this md", "render the markdown", "open the doc as a webpage", "render and open", "open the handoff in html", "view this md in browser", "edit this md live", "serve this markdown", "spin up the editor".
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

Two modes — pick based on whether the user wants to *look* or *edit*.

### One-shot (static file)

Render once to an HTML file and open it. Right for "show me this doc" or
the trailing offer after writing a handoff/plan.

```bash
bun run ~/.claude/skills/render-markdown/scripts/render-md.ts <input.md> [out.html]
open <out.html>
```

Default output path is `/tmp/preview.html`. The script prints the output
path on stdout: `OUT=$(bun run … input.md) && open $OUT`.

### Live editor (server)

Spin up a tiny local server with a CodeMirror editor + live preview.
Right for "let me edit this" or "open it so I can iterate."

```bash
bun run ~/.claude/skills/render-markdown/scripts/render-md.ts serve <input.md> [port]
# then open http://localhost:7780 (or the printed port)
```

UI: single pane that toggles between **read** (rendered preview iframe)
and **raw** (CodeMirror markdown source). Top-right has the mode toggle
(eye / pencil) and the theme toggle (sun / system / moon) separated by a
1px divider. Keyboard: `Cmd-E` flips modes.

Edits in raw mode autosave to the source file (350ms debounce). The
preview reloads on save and on mode-flip to live. Theme + mode persist
in `localStorage`. The editor has no external-change watcher yet, so if
something else edits the file while CodeMirror has it open, the next
autosave will clobber that change — reload the editor tab to pick up
external edits.

### Shared rendering

Both modes share the same renderer: YAML frontmatter is stripped (so
`marked` doesn't promote it to a giant heading via setext rules), the
body is rendered with GFM and footnotes, code blocks are syntax-
highlighted via `highlight.js`, and ` ```mermaid ` fenced blocks render
as real diagrams via the Mermaid ESM bundle (CDN, loaded only when a
mermaid block is present). The output is a self-contained HTML page in
one-shot mode; in server mode the same page is served at `/preview` with
the theme toggle hidden (the outer editor page owns it).

### File layout

The script is split across five files in `scripts/`, inlined at render
time via bun's `import x from "./foo.ext" with { type: "text" }` syntax:

| File | Role |
|---|---|
| `render-md.ts` | Markdown → HTML assembly + `serve` subcommand (Bun.serve). |
| `styles.css` | Prose design tokens, light/dark themes, code, tables, footnotes, in-preview theme toggle. |
| `theme-toggle.html` | Sun / monitor / moon toggle markup + persistence script (used inside the preview HTML). |
| `mermaid-init.js` | Mermaid bootstrap with theme-aware initialization. |
| `editor.html` | Server-mode UI: CodeMirror (via esm.sh import map), mode toggle, theme toggle, autosave. |

Edit any one concern in isolation; no build step. If you change
`styles.css` or `editor.html`, restart the server (`bun run … serve`) —
bun text imports are loaded once at startup.

Design tokens follow the `prose-typography` skill: 680px measure,
16px/1.6 body, h2 with 2.6em top margin, borders and inline-code
backgrounds derived from the text color at low alpha so the surface
themes coherently in both modes.

## Conventions

- Default to one-shot mode unless the user asks to edit, iterate, or
  serve. One-shot is cheaper and disposable.
- One-shot output path defaults to `/tmp/preview.html`. Overwriting is
  fine — this is throwaway preview output.
- Server mode defaults to port `7780`. If that's in use, pass a free
  port as the third argument. Don't try to "park" a server in the
  background without telling the user — they need to know the URL.
- After opening, give a one-line confirmation (what file you rendered,
  where it landed). Don't dump the HTML contents.
- If the user iterates on the source file and asks to "open again", just
  re-run the script — the output path stays stable so the existing
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
  `highlight.js` — bun auto-installs them on first run. `import … with
  { type: "text" }` for the adjacent CSS/HTML/JS files requires bun ≥ 1.1.
- `open` (macOS) for one-shot mode — substitute `xdg-open` on Linux or
  `start` on Windows.
- Network on first render of a doc with mermaid (Mermaid ESM via CDN).
  Server mode also loads CodeMirror from `esm.sh` (with an import map
  pinning shared CodeMirror deps to dedupe state across packages).
  Re-renders cache the bundles in the browser.
