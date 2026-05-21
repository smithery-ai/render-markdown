#!/usr/bin/env bun
/**
 * Render a markdown file to a styled HTML page, or serve a live editor.
 *
 *   bun run render-md.ts <input.md> [out.html]
 *     One-shot: render input.md → out.html (default /tmp/preview.html).
 *
 *   bun run render-md.ts serve <input.md> [port]
 *     Live editor: split-pane CodeMirror + iframe preview on localhost:<port>
 *     (default 7780). Edits debounce-save to the source file.
 *
 * Notes:
 * - YAML frontmatter is stripped so marked doesn't promote it to a giant H2
 *   via setext rules, and is shown as a compact monospace block.
 * - GFM (task lists, tables) and footnotes are on by default.
 * - Title comes from `title:` in frontmatter, otherwise from first H1, otherwise "doc".
 *
 * The HTML shell is assembled here; CSS, theme toggle, mermaid bootstrap, and
 * the editor UI live in adjacent files and are inlined via bun text imports.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { marked } from "marked"
import markedFootnote from "marked-footnote"
import hljs from "highlight.js"
// Mermaid's headless parser path calls DOMPurify.addHook eagerly even for
// diagram types we never render server-side. Stub it before mermaid loads
// so parse() works without a DOM.
import DOMPurify from "dompurify"
;(DOMPurify as any).addHook ??= () => {}
;(DOMPurify as any).sanitize ??= (x: string) => x
;(DOMPurify as any).removeHook ??= () => {}
const mermaid = (await import("mermaid")).default

import styles from "./styles.css" with { type: "text" }
import themeToggle from "./theme-toggle.html" with { type: "text" }
import mermaidInit from "./mermaid-init.js" with { type: "text" }
import editorHtml from "./editor.html" with { type: "text" }
import copyButton from "./copy-button.js" with { type: "text" }

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
marked.setOptions({ gfm: true, breaks: false })

const PRE_THEME_SCRIPT = `(function(){var t=localStorage.getItem('theme');if(t&&t!=='system')document.documentElement.dataset.theme=t})()`

interface MermaidIssue {
	index: number
	message: string
}

async function validateMermaidBlocks(src: string): Promise<MermaidIssue[]> {
	const issues: MermaidIssue[] = []
	const blocks = [...src.matchAll(/```mermaid\n([\s\S]*?)\n```/g)]
	for (let i = 0; i < blocks.length; i++) {
		const code = blocks[i][1]
		if (/<br\s*\/?>/i.test(code)) {
			issues.push({ index: i + 1, message: "uses <br/> in label — forbidden; use a shorter label or split nodes" })
			continue
		}
		try {
			await mermaid.parse(code)
		} catch (e: any) {
			issues.push({ index: i + 1, message: (e?.message ?? String(e)).split("\n").slice(0, 4).join("\n") })
		}
	}
	return issues
}

async function renderToHtml(src: string, opts: { embed?: boolean } = {}): Promise<string> {
	const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n/)
	const fm = fmMatch ? fmMatch[1] : ""
	const body = fmMatch ? src.slice(fmMatch[0].length) : src

	const rendered = await marked.parse(body)

	const fmTitle = fm.match(/^title:\s*(.+)$/m)?.[1]?.trim()
	const h1Title = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
	const title = (fmTitle ?? h1Title ?? "doc").replace(/</g, "&lt;")

	const mermaidBlock = /<pre class="mermaid">/.test(rendered)
		? `<script type="module">${mermaidInit}</script>`
		: ""
	const fmBlock = fm
		? `<div class="frontmatter">${fm.replace(/</g, "&lt;")}</div>`
		: ""

	const embedStyle = opts.embed
		? `<style>.theme-toggle{display:none}body{background:transparent}</style>`
		: ""

	return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<script>${PRE_THEME_SCRIPT}</script>
<style>${styles}</style>${embedStyle}
</head><body>
${themeToggle}
${fmBlock}
${rendered}
${mermaidBlock}
<script>${copyButton}</script>
</body></html>`
}

async function serve(inputPath: string, port: number) {
	const noCache = { "cache-control": "no-store" }
	const server = Bun.serve({
		port,
		async fetch(req) {
			const url = new URL(req.url)
			if (url.pathname === "/") {
				return new Response(editorHtml, {
					headers: { "content-type": "text/html", ...noCache },
				})
			}
			if (url.pathname === "/preview") {
				const src = readFileSync(inputPath, "utf8")
				const embed = url.searchParams.get("embed") === "1"
				const html = await renderToHtml(src, { embed })
				return new Response(html, {
					headers: { "content-type": "text/html", ...noCache },
				})
			}
			if (url.pathname === "/api/source" && req.method === "GET") {
				const src = readFileSync(inputPath, "utf8")
				return new Response(src, {
					headers: { "content-type": "text/plain; charset=utf-8", ...noCache },
				})
			}
			if (url.pathname === "/api/save" && req.method === "POST") {
				const text = await req.text()
				writeFileSync(inputPath, text)
				return new Response("ok", { headers: noCache })
			}
			return new Response("not found", { status: 404 })
		},
	})
	console.log(`Editing ${inputPath} at http://localhost:${server.port}`)
}

const args = process.argv.slice(2)

if (args[0] === "serve") {
	const inputPath = args[1]
	if (!inputPath) {
		console.error("usage: render-md.ts serve <input.md> [port]")
		process.exit(2)
	}
	const port = parseInt(args[2] ?? "7780", 10)
	await serve(inputPath, port)
} else {
	const inputPath = args[0]
	if (!inputPath) {
		console.error("usage:\n  render-md.ts <input.md> [out.html]\n  render-md.ts serve <input.md> [port]")
		process.exit(2)
	}
	const outPath = args[1] ?? "/tmp/preview.html"
	const src = readFileSync(inputPath, "utf8")
	const issues = await validateMermaidBlocks(src)
	if (issues.length) {
		console.error(`mermaid validation failed (${issues.length} issue${issues.length > 1 ? "s" : ""}):`)
		for (const it of issues) console.error(`  block #${it.index}: ${it.message}`)
		process.exit(1)
	}
	const html = await renderToHtml(src)
	writeFileSync(outPath, html)
	console.log(outPath)
}
