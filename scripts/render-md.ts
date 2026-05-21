#!/usr/bin/env bun
/**
 * Render a markdown file to a small styled HTML page.
 *
 * Usage: bun run render-md.ts <input.md> [out.html]
 *
 * - Strips YAML frontmatter (so marked doesn't promote it to a giant H2 via
 *   setext-heading rules) and shows it as a compact monospace block.
 * - GFM (task lists, tables) on by default.
 * - Title comes from `title:` in frontmatter, otherwise from first H1, otherwise "doc".
 *
 * The HTML shell is assembled here; CSS, the theme toggle UI, and mermaid bootstrap
 * are kept in adjacent files (styles.css, theme-toggle.html, mermaid-init.js) and
 * inlined at render time via bun's `with { type: "text" }` imports.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { marked } from "marked"
import markedFootnote from "marked-footnote"
import hljs from "highlight.js"

import styles from "./styles.css" with { type: "text" }
import themeToggle from "./theme-toggle.html" with { type: "text" }
import mermaidInit from "./mermaid-init.js" with { type: "text" }

marked.use(markedFootnote())
marked.use({
	renderer: {
		code(token: any) {
			const code: string = token.text ?? ""
			const lang: string = (token.lang ?? "").split(/\s+/)[0]
			if (lang === "mermaid") {
				const escaped = code.replace(/</g, "&lt;").replace(/>/g, "&gt;")
				return `<pre class="mermaid">${escaped}</pre>\n`
			}
			const out =
				lang && hljs.getLanguage(lang)
					? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
					: hljs.highlightAuto(code).value
			return `<pre><code class="hljs language-${lang}">${out}</code></pre>\n`
		},
	},
})

const input = process.argv[2]
if (!input) {
	console.error("usage: render-md.ts <input.md> [out.html]")
	process.exit(2)
}
const outPath = process.argv[3] ?? "/tmp/preview.html"

const src = readFileSync(input, "utf8")
const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n/)
const fm = fmMatch ? fmMatch[1] : ""
const body = fmMatch ? src.slice(fmMatch[0].length) : src

marked.setOptions({ gfm: true, breaks: false })
const rendered = await marked.parse(body)

const fmTitle = fm.match(/^title:\s*(.+)$/m)?.[1]?.trim()
const h1Title = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
const title = (fmTitle ?? h1Title ?? "doc").replace(/</g, "&lt;")

const preThemeScript = `(function(){var t=localStorage.getItem('theme');if(t&&t!=='system')document.documentElement.dataset.theme=t})()`
const mermaidBlock = /mermaid/.test(rendered)
	? `<script type="module">${mermaidInit}</script>`
	: ""
const fmBlock = fm
	? `<div class="frontmatter">${fm.replace(/</g, "&lt;")}</div>`
	: ""

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<script>${preThemeScript}</script>
<style>${styles}</style>
</head><body>
${themeToggle}
${fmBlock}
${rendered}
${mermaidBlock}
</body></html>`

writeFileSync(outPath, html)
console.log(outPath)
