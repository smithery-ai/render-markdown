---
name: render-markdown
description: Render a local markdown file to a styled HTML page with Mermaid diagram support — either one-shot (static file, open in browser) or as a live CodeMirror editor on a local server with read/raw mode toggle and autosave. Use whenever the user wants to preview a markdown file (handoff doc, README, design note, planning checklist, anything with YAML frontmatter or GFM task-list checkboxes) without launching a dev server or a heavy editor. Also use whenever the user asks you to explain or walk through something using markdown plus mermaid diagrams (architecture, flow, sequence, system overview), write the explanation to a .md file with embedded mermaid code blocks, then render it with this skill. Use the server mode when the user wants to iterate on the source live, switch between rendered and raw, or share a localhost preview. Triggers on phrases like "open this in html", "preview this md", "render the markdown", "open the doc as a webpage", "render and open", "open the handoff in html", "view this md in browser", "edit this md live", "serve this markdown", "spin up the editor", "explain with a diagram", "explain with mermaid", "draw this out", "walk me through with a diagram".
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

Two modes. **Default to the live editor.** Only use one-shot when the
user explicitly asks for a static HTML file (phrases like "render to
html", "give me an html file", "one-shot", "static preview", "save as
html", or they hand you an output path).

### Live editor (server) — default

Spin up a tiny local server with a CodeMirror editor + live preview,
then open the URL.

```bash
bun run ~/.claude/skills/render-markdown/scripts/render-md.ts serve <input.md> [port]
open http://localhost:7780
```

The server's read-mode preview is the answer to "show me this doc" too —
the user lands on rendered output and can flip to raw with `Cmd-E` if
they want to edit. There's no downside to serving by default; it's the
same renderer plus an editor toggle.

### One-shot (static file) — only when asked

Render once to an HTML file and open it. Use only when the user
explicitly wants a self-contained HTML artifact.

```bash
bun run ~/.claude/skills/render-markdown/scripts/render-md.ts <input.md> [out.html]
open <out.html>
```

Default output path is `/tmp/preview.html`. The script prints the output
path on stdout: `OUT=$(bun run … input.md) && open $OUT`.

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

### Mermaid validation

One-shot mode runs every ` ```mermaid ` block through `mermaid.parse()`
before writing HTML. If any block fails, the script prints `block #N:
<message>` and exits 1 — nothing is written, nothing is opened. Fix the
block (usually a label that needs quotes) and re-run.

Server mode does not pre-validate — the browser surfaces mermaid errors
live in the preview pane as the user types. Since serve mode is the
default, expect to see mermaid syntax errors rendered in the page
itself; that's working as intended.

**Rules for mermaid blocks:**

- **Never use `<br/>` (or `<br>`) inside node labels.** It renders
  inconsistently across mermaid versions and the validator rejects it.
  Use a shorter label, split into two nodes, or put the second line in
  prose below the diagram.
- **Quote any label that starts with `/`, contains `(`, `)`, `[`, `]`,
  `:`, or other shape-syntax characters.** `A["/tmp/x.html"]` not
  `A[/tmp/x.html]` — the latter parses as a trapezoid shape and lexes
  badly.

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

- **Default to server mode.** It gives the user a rendered preview *and*
  an edit toggle for the cost of one extra process. Reach for one-shot
  only when the user explicitly asks for a static HTML file or an
  output path.
- Server mode defaults to port `7780`. If that's in use, pass a free
  port as the third argument. Run it with `run_in_background: true` and
  tell the user the URL — they need to know where to open it.
- If the server is already running for the same file, don't spin up a
  second one. Just point the user back at the existing URL (or open it
  again).
- One-shot output path defaults to `/tmp/preview.html`. Overwriting is
  fine — this is throwaway preview output.
- After opening, give a one-line confirmation (what file, what URL or
  path). Don't dump the HTML contents.
- If the user iterates on the source file and asks to "open again" in
  server mode, the browser tab is already live — no rerun needed. In
  one-shot mode, re-run the script; the output path stays stable so the
  existing browser tab refreshes.

## Why a script instead of inline rendering

The frontmatter quirk (setext heading promotion when `---` follows
key/value lines) is the kind of thing that bites every time someone
reimplements this inline with `marked`. Bundling the script means we fix
it once. The design tokens, dark mode, theme toggle, footnote handling,
syntax highlighting, mermaid wiring, and table/checkbox styling also
stay consistent across previews.

## Dependencies

- `bun` on PATH. The script imports `marked`, `marked-footnote`,
  `highlight.js`, and `mermaid` (used headlessly for one-shot
  validation) — bun auto-installs them on first run. `import … with
  { type: "text" }` for the adjacent CSS/HTML/JS files requires bun ≥ 1.1.
- `open` (macOS) for one-shot mode — substitute `xdg-open` on Linux or
  `start` on Windows.
- Network on first render of a doc with mermaid (Mermaid ESM via CDN).
  Server mode also loads CodeMirror from `esm.sh` (with an import map
  pinning shared CodeMirror deps to dedupe state across packages).
  Re-renders cache the bundles in the browser.
