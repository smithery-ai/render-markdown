#!/usr/bin/env bun
/**
 * Render a markdown (.md), YAML (.yaml/.yml), or Gherkin (.feature) file to a
 * styled HTML page, or serve a live editor.
 *
 *   bun run render-md.ts <input.{md,yaml,yml,feature}> [out.html]
 *     One-shot: render input → out.html (default /tmp/preview.html).
 *
 *   bun run render-md.ts serve <input> [port]
 *     Live editor: split-pane CodeMirror + iframe preview on localhost:<port>
 *     (default 7780). Edits debounce-save to the source file.
 *
 * Notes:
 * - Markdown YAML frontmatter is stripped so marked doesn't promote it to a
 *   giant H2 via setext rules, and is shown as a compact monospace block.
 * - GFM (task lists, tables) and footnotes are on by default.
 * - YAML files render as a structured document: top-level keys become
 *   sections, nested objects nest by heading level, lists of objects render
 *   as numbered cards, and multi-line string values are treated as markdown
 *   (because YAML block scalars typically contain prose).
 * - Gherkin .feature files are parsed with the official @cucumber/gherkin
 *   parser and rendered semantically: Feature/Rule/Scenario/Background as
 *   headed sections, steps with color-coded keywords, data tables and
 *   Examples as tables, doc strings as code, tags as chips, comments as
 *   notes. Invalid Gherkin falls back to a highlighted code block.
 * - Title comes from `title:` in frontmatter, otherwise from first H1, otherwise "doc".
 *
 * The HTML shell is assembled here; CSS, theme toggle, and the editor UI live
 * in adjacent files and are inlined via bun text imports. Mermaid diagrams are
 * rendered to inline SVG at build time via beautiful-mermaid (no client JS).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { extname } from "node:path"
import { marked } from "marked"
import markedFootnote from "marked-footnote"
import hljs from "highlight.js"
import { parse as parseYaml } from "yaml"
import {
	AstBuilder,
	GherkinClassicTokenMatcher,
	Parser as GherkinParser,
} from "@cucumber/gherkin"
import { IdGenerator } from "@cucumber/messages"
// Mermaid diagrams are rendered to inline SVG at build time via
// beautiful-mermaid — synchronous, zero DOM deps, no CDN. Colors are passed
// as CSS variables so the page's light/dark toggle drives the diagram live
// (beautiful-mermaid emits them as custom properties on the <svg>, no
// re-render needed).
import { renderMermaidSVG } from "beautiful-mermaid"

import styles from "./styles.css" with { type: "text" }
import themeToggle from "./theme-toggle.html" with { type: "text" }
import editorHtml from "./editor.html" with { type: "text" }
import copyButton from "./copy-button.js" with { type: "text" }

// Mono mode: pass only solid bg/fg (+ a solid accent) and let beautiful-mermaid
// derive the text tiers (secondary, muted, faint), node fills, and strokes as
// solid color-mix() blends. Do NOT pass muted/surface/border/line from our
// design tokens — those are low-alpha rgba (e.g. --fg-muted is 0.62 alpha), and
// beautiful-mermaid maps `muted` straight onto the secondary/muted TEXT color,
// which washes the labels out. --bg/--fg/--accent are solid hex, so the
// derivations land at proper contrast and still track the light/dark toggle.
//
// `font` must be a SINGLE family name — beautiful-mermaid emits
// `font-family: '<font>', system-ui, sans-serif`, so a multi-family stack here
// becomes an invalid quoted value and the browser falls back to a font whose
// glyph widths don't match the measured boxes (text overlap). "Inter" is what
// its text-metrics are tuned for; it degrades to system-ui.
// --mm-* are literal-valued aliases (styles.css) so beautiful-mermaid can write
// them onto the <svg> as --bg/--fg/--accent without a self-referential cycle.
const MERMAID_OPTS = {
	bg: "var(--mm-bg)",
	fg: "var(--mm-fg)",
	accent: "var(--mm-accent)",
	muted: "var(--mm-muted)",
	font: "Inter",
	transparent: true,
	padding: 24,
}

function renderMermaidBlock(code: string): { svg?: string; error?: string } {
	try {
		// beautiful-mermaid injects a Google Fonts @import for the diagram
		// font. Strip it so the page stays self-contained / offline — the SVG
		// geometry is fully inline, and the text falls back to system-ui.
		const svg = renderMermaidSVG(code, MERMAID_OPTS).replace(
			/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);?/g,
			"",
		)
		return { svg }
	} catch (e: any) {
		return { error: (e?.message ?? String(e)).split("\n").slice(0, 5).join("\n") }
	}
}

marked.use(markedFootnote())
marked.use({
	renderer: {
		code(token: any) {
			const code: string = token.text ?? ""
			const lang: string = (token.lang ?? "").split(/\s+/)[0]
			if (lang === "mermaid") {
				const { svg, error } = renderMermaidBlock(code)
				if (error) {
					const safe = error.replace(/</g, "&lt;").replace(/>/g, "&gt;")
					return `<pre class="mermaid-error"><code>mermaid render failed:\n${safe}</code></pre>\n`
				}
				return `<figure class="mermaid-svg">${svg}</figure>\n`
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

function validateMermaidBlocks(src: string): MermaidIssue[] {
	const issues: MermaidIssue[] = []
	const blocks = [...src.matchAll(/```mermaid\n([\s\S]*?)\n```/g)]
	for (let i = 0; i < blocks.length; i++) {
		const { error } = renderMermaidBlock(blocks[i][1])
		if (error) issues.push({ index: i + 1, message: error })
	}
	return issues
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Render a parsed YAML value as semantic HTML.
 *
 *  Walking rules:
 *  - Objects: each key becomes a heading (h2..h6 by depth) over its value.
 *  - Arrays of scalars: bulleted list.
 *  - Arrays of objects: numbered sections — first scalar-valued key acts as
 *    the section label so cards have a recognizable handle (e.g. `id:`
 *    or `branch:` on each path-node).
 *  - Strings: multi-line strings (likely block scalars holding prose) get
 *    rendered as markdown; single-line strings stay plain text so short
 *    scalars don't get promoted to paragraphs.
 *  - Numbers / booleans / null: small monospace tag.
 *
 *  Depth starts at 2 because the document title (top-level `title:` or the
 *  filename) owns h1 — keeps the type hierarchy intact for screen readers
 *  and CSS that styles by level. */
async function renderYamlNode(node: unknown, depth: number): Promise<string> {
	if (node === null || node === undefined) {
		return `<code class="yaml-null">null</code>`
	}
	if (typeof node === "boolean" || typeof node === "number") {
		return `<code class="yaml-scalar">${escapeHtml(String(node))}</code>`
	}
	if (typeof node === "string") {
		if (node.includes("\n") || node.length > 120) {
			// Block-scalar or long string: treat as markdown so embedded
			// emphasis, code spans, and lists render correctly.
			return `<div class="yaml-prose">${await marked.parse(node)}</div>`
		}
		return `<span class="yaml-string">${escapeHtml(node)}</span>`
	}
	if (Array.isArray(node)) {
		const items = node
		if (items.length === 0) return `<code class="yaml-null">[]</code>`
		const allScalar = items.every(
			(x) => x === null || ["string", "number", "boolean"].includes(typeof x),
		)
		if (allScalar) {
			const parts: string[] = []
			for (const item of items) {
				parts.push(`<li>${await renderYamlNode(item, depth + 1)}</li>`)
			}
			return `<ul class="yaml-list">${parts.join("")}</ul>`
		}
		// Array of objects: numbered cards, with a recognizable label from
		// the first scalar-valued key if present.
		const parts: string[] = []
		for (let i = 0; i < items.length; i++) {
			const item = items[i]
			const labelEntry =
				item && typeof item === "object" && !Array.isArray(item)
					? Object.entries(item as Record<string, unknown>).find(
							([, v]) => typeof v === "string" && !v.includes("\n") && v.length < 80,
						)
					: undefined
			const labelHtml = labelEntry
				? `<header class="yaml-card-label"><code>${escapeHtml(labelEntry[0])}</code> ${escapeHtml(String(labelEntry[1]))}</header>`
				: ""
			parts.push(
				`<li class="yaml-card">${labelHtml}${await renderYamlNode(item, depth + 1)}</li>`,
			)
		}
		return `<ol class="yaml-cards">${parts.join("")}</ol>`
	}
	if (typeof node === "object") {
		const parts: string[] = []
		const entries = Object.entries(node as Record<string, unknown>)
		const headingLevel = Math.min(Math.max(depth, 2), 6)
		for (const [k, v] of entries) {
			const isScalar =
				v === null || ["string", "number", "boolean"].includes(typeof v)
			const isShortScalar =
				isScalar && (typeof v !== "string" || (!v.includes("\n") && v.length < 80))
			if (isShortScalar) {
				// Compact key/value row to keep dense headers readable.
				parts.push(
					`<div class="yaml-kv"><code class="yaml-key">${escapeHtml(k)}</code> ${await renderYamlNode(v, depth + 1)}</div>`,
				)
			} else {
				parts.push(
					`<h${headingLevel} class="yaml-heading">${escapeHtml(k)}</h${headingLevel}>${await renderYamlNode(v, depth + 1)}`,
				)
			}
		}
		return parts.join("\n")
	}
	return `<code>${escapeHtml(String(node))}</code>`
}

async function renderYamlToBody(src: string): Promise<{ body: string; title: string }> {
	const doc = parseYaml(src)
	let title = "doc"
	if (doc && typeof doc === "object" && !Array.isArray(doc)) {
		const d = doc as Record<string, unknown>
		const firstStr = (k: string) =>
			typeof d[k] === "string" ? (d[k] as string) : undefined
		title = firstStr("title") ?? firstStr("name") ?? firstStr("instance") ?? "doc"
	}
	const rendered = await renderYamlNode(doc, 2)
	const body = `<h1 class="yaml-title">${escapeHtml(title)}</h1>${rendered}`
	return { body, title }
}

const YAML_EXTRA_STYLES = `
.yaml-title { margin-top: 0; }
.yaml-heading { margin-top: 2em; margin-bottom: 0.5em; font-weight: 600; }
.yaml-heading code, .yaml-key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
.yaml-key { color: var(--fg-muted); margin-right: 0.5em; }
.yaml-kv { display: flex; gap: 0.5em; align-items: baseline; margin: 0.25em 0; flex-wrap: wrap; }
.yaml-kv .yaml-string { color: var(--fg); }
.yaml-cards { list-style: none; padding: 0; margin: 0.5em 0; counter-reset: card; }
.yaml-cards > .yaml-card { counter-increment: card; border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; margin: 12px 0; background: var(--surface-soft); }
.yaml-cards > .yaml-card::before { content: counter(card) "."; color: var(--fg-quiet); font-variant-numeric: tabular-nums; font-weight: 600; margin-right: 0.5em; }
.yaml-card-label { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--accent); font-size: 0.95em; margin-bottom: 0.5em; display: inline; }
.yaml-card-label code { background: transparent; padding: 0; }
.yaml-prose { margin: 0.25em 0; }
.yaml-prose p { margin: 0.5em 0; }
.yaml-list { margin: 0.5em 0; }
.yaml-null { color: var(--fg-quiet); }
.yaml-scalar { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
`

/* ── Gherkin (.feature) rendering ──────────────────────────────────────────
 *
 * A .feature file is a structured spec, not prose, so we parse it with the
 * official Gherkin parser and render the AST semantically: Feature → h1 with
 * an eyebrow label and description, Rule → h2 section, Scenario / Background →
 * headed blocks of steps, steps with the keyword (Given/When/Then) color-coded,
 * data tables and Examples as real tables, doc strings as code blocks, tags as
 * chips. Comments are flushed in document order as muted notes so the
 * backed-by header and inline rule notes survive. If parsing throws (invalid
 * Gherkin), we fall back to a syntax-highlighted code block so the file is
 * still legible and the error is easy to spot.
 */

function gherkinStepClass(keyword: string): string {
	switch (keyword.trim()) {
		case "Given":
			return "gh-given"
		case "When":
			return "gh-when"
		case "Then":
			return "gh-then"
		default:
			return "gh-and"
	}
}

function gherkinStepText(text: string): string {
	let s = escapeHtml(text)
	// Highlight <placeholders> (escaped to &lt;..&gt;), "quoted literals", and
	// `backticked` identifiers (rendered as inline code).
	s = s.replace(/&lt;([^&]+?)&gt;/g, '<span class="gh-ph">&lt;$1&gt;</span>')
	s = s.replace(/`([^`]+)`/g, "<code>$1</code>")
	s = s.replace(/"([^"]*)"/g, '<span class="gh-str">"$1"</span>')
	return s
}

function gherkinTags(tags: any[] | undefined): string {
	if (!tags || tags.length === 0) return ""
	return `<div class="gh-tags">${tags
		.map((t) => `<span class="gh-tag">${escapeHtml(t.name)}</span>`)
		.join("")}</div>`
}

function gherkinProse(text: string): string {
	const lines = text
		.replace(/^\n+/, "")
		.replace(/\n+$/, "")
		.split("\n")
		.map((l) => l.trim())
	if (lines.every((l) => l === "")) return ""
	return `<p class="gh-desc">${lines.map(escapeHtml).join("<br>")}</p>`
}

// A Feature/Scenario description is free text, so it may embed a ```mermaid
// fenced block. Render those as inline SVG (schema/architecture diagrams live
// right in the spec); prose around them stays as paragraphs.
function gherkinDesc(desc: string | undefined): string {
	if (!desc) return ""
	const trimmed = desc.replace(/^\n+/, "").replace(/\n+$/, "")
	const re = /```mermaid\n([\s\S]*?)```/g
	const parts: string[] = []
	let last = 0
	let m: RegExpExecArray | null
	while ((m = re.exec(trimmed)) !== null) {
		parts.push(gherkinProse(trimmed.slice(last, m.index)))
		const { svg, error } = renderMermaidBlock(m[1].replace(/\n+$/, ""))
		parts.push(
			error
				? `<pre class="mermaid-error"><code>${escapeHtml(error)}</code></pre>`
				: `<figure class="mermaid-svg">${svg}</figure>`,
		)
		last = re.lastIndex
	}
	parts.push(gherkinProse(trimmed.slice(last)))
	return parts.filter(Boolean).join("")
}

function gherkinTable(rows: any[] | undefined, caption?: string): string {
	if (!rows || rows.length === 0) return ""
	const [head, ...body] = rows
	const cap = caption
		? `<caption class="gh-table-cap">${escapeHtml(caption)}</caption>`
		: ""
	const th = head.cells.map((c: any) => `<th>${escapeHtml(c.value)}</th>`).join("")
	const trs = body
		.map(
			(r: any) =>
				`<tr>${r.cells.map((c: any) => `<td>${escapeHtml(c.value)}</td>`).join("")}</tr>`,
		)
		.join("")
	return `<table class="gh-table">${cap}<thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`
}

function gherkinStep(step: any): string {
	const kw = step.keyword.trim()
	let out = `<div class="gh-step"><span class="gh-kw ${gherkinStepClass(kw)}">${escapeHtml(kw)}</span> <span class="gh-text">${gherkinStepText(step.text)}</span></div>`
	if (step.dataTable) {
		// A `backticked` identifier in the step text captions the attached
		// data table — e.g. the table/entity name shown on top of the values.
		const caption = (step.text.match(/`([^`]+)`/) ?? [])[1]
		out += gherkinTable(step.dataTable.rows, caption)
	}
	if (step.docString)
		out += `<pre class="gh-docstring"><code>${escapeHtml(step.docString.content)}</code></pre>`
	return out
}

function gherkinExamples(examples: any[] | undefined): string {
	if (!examples || examples.length === 0) return ""
	return examples
		.map((ex) => {
			const rows = ex.tableHeader
				? [ex.tableHeader, ...(ex.tableBody ?? [])]
				: (ex.tableBody ?? [])
			const label = `${ex.keyword}${ex.name ? `: ${ex.name}` : ""}`
			return `<div class="gh-examples">${gherkinTags(ex.tags)}<div class="gh-examples-label">${escapeHtml(label)}</div>${gherkinTable(rows)}</div>`
		})
		.join("")
}

function gherkinScenario(sc: any, level: number, kind: "scenario" | "background"): string {
	const h = `h${Math.min(level, 6)}`
	let out = `<section class="gh-${kind}">`
	out += gherkinTags(sc.tags)
	out += `<${h} class="gh-block-name"><span class="gh-kw-label">${escapeHtml(sc.keyword)}</span>${sc.name ? ` ${escapeHtml(sc.name)}` : ""}</${h}>`
	out += gherkinDesc(sc.description)
	out += `<div class="gh-steps">${(sc.steps ?? []).map(gherkinStep).join("")}</div>`
	out += gherkinExamples(sc.examples)
	out += `</section>`
	return out
}

function renderFeatureToBody(src: string): { body: string; title: string } {
	const parser = new GherkinParser(
		new AstBuilder(IdGenerator.uuid()),
		new GherkinClassicTokenMatcher(),
	)
	const doc = parser.parse(src)
	const feature = doc.feature
	if (!feature) {
		const code = hljs.highlight(src, { language: "gherkin", ignoreIllegals: true }).value
		return { body: `<pre><code class="hljs language-gherkin">${code}</code></pre>`, title: "feature" }
	}

	// Comments in document order; flushed as we pass each node's line so the
	// backed-by header and inline rule notes land in roughly the right place.
	const comments = (doc.comments ?? [])
		.slice()
		.sort((a: any, b: any) => a.location.line - b.location.line)
	let cursor = 0
	const flushBefore = (line: number): string => {
		const pending: string[] = []
		while (cursor < comments.length && comments[cursor].location.line < line) {
			pending.push(comments[cursor].text.replace(/^\s*#\s?/, ""))
			cursor++
		}
		if (pending.length === 0) return ""
		return `<div class="gh-comment">${pending.map(escapeHtml).join("<br>")}</div>`
	}

	let body = ""
	body += flushBefore(feature.location.line)
	body += gherkinTags(feature.tags)
	body += `<div class="gh-eyebrow">${escapeHtml(feature.keyword)}</div>`
	body += `<h1 class="gh-feature-name">${escapeHtml(feature.name)}</h1>`
	body += gherkinDesc(feature.description)

	for (const child of feature.children ?? []) {
		if (child.background) {
			body += flushBefore(child.background.location.line)
			body += gherkinScenario(child.background, 2, "background")
		} else if (child.scenario) {
			body += flushBefore(child.scenario.location.line)
			body += gherkinScenario(child.scenario, 2, "scenario")
		} else if (child.rule) {
			const rule = child.rule
			body += flushBefore(rule.location.line)
			body += `<section class="gh-rule">`
			body += gherkinTags(rule.tags)
			body += `<h2 class="gh-rule-name"><span class="gh-kw-label">${escapeHtml(rule.keyword)}</span>${rule.name ? ` ${escapeHtml(rule.name)}` : ""}</h2>`
			body += gherkinDesc(rule.description)
			for (const rc of rule.children ?? []) {
				if (rc.background) {
					body += flushBefore(rc.background.location.line)
					body += gherkinScenario(rc.background, 3, "background")
				} else if (rc.scenario) {
					body += flushBefore(rc.scenario.location.line)
					body += gherkinScenario(rc.scenario, 3, "scenario")
				}
			}
			body += `</section>`
		}
	}
	// Trailing comments (after the last node).
	body += flushBefore(Number.MAX_SAFE_INTEGER)

	return { body, title: feature.name || "feature" }
}

const GHERKIN_EXTRA_STYLES = `
:root { --gh-given: #3b6fb0; --gh-when: var(--accent); --gh-then: #3a8c5a; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --gh-given: #82aaff; --gh-then: #7bc089; } }
:root[data-theme="dark"] { --gh-given: #82aaff; --gh-then: #7bc089; }
.gh-eyebrow { font-size: .8em; text-transform: uppercase; letter-spacing: .1em; color: var(--accent); font-weight: 600; margin-bottom: .2em; }
.gh-feature-name { margin-top: 0; }
.gh-desc { color: var(--fg-muted); margin: .4em 0 1.4em; }
.gh-comment { font: 12.5px/1.55 ui-monospace, "SF Mono", Menlo, monospace; color: var(--fg-quiet); border-left: 2px solid var(--border); padding: .3em 0 .3em .9em; margin: 1em 0; white-space: normal; }
.gh-rule { margin: 2.4em 0 0; }
.gh-rule-name { border-bottom: 1px solid var(--border); padding-bottom: .3em; }
.gh-rule .gh-scenario, .gh-rule .gh-background { margin-left: 0; }
.gh-scenario, .gh-background { margin: 1.6em 0; padding-left: 14px; border-left: 2px solid var(--border); }
.gh-background { border-left-color: var(--border-strong); }
.gh-block-name { margin-top: .2em; }
.gh-kw-label { color: var(--fg-quiet); font-weight: 600; margin-right: .15em; }
.gh-rule-name .gh-kw-label { color: var(--accent); }
.gh-steps { margin: .5em 0; }
.gh-step { display: flex; gap: .5em; align-items: baseline; padding: .12em 0; line-height: 1.5; }
.gh-kw { flex: none; min-width: 3.4em; text-align: right; font-weight: 600; font-size: .9em; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.gh-given { color: var(--gh-given); }
.gh-when { color: var(--gh-when); }
.gh-then { color: var(--gh-then); }
.gh-and { color: var(--fg-quiet); }
.gh-text { color: var(--fg); }
.gh-ph { color: var(--accent); font-weight: 500; }
.gh-str { color: var(--fg); background: var(--surface-soft); padding: 0 .25em; border-radius: 3px; }
.gh-tags { display: flex; flex-wrap: wrap; gap: .35em; margin: .4em 0; }
.gh-tag { font: .8em ui-monospace, Menlo, monospace; color: var(--accent); background: var(--accent-selection); padding: .08em .5em; border-radius: 999px; }
.gh-examples { margin: .8em 0 .8em 14px; }
.gh-examples-label { font-size: .85em; text-transform: uppercase; letter-spacing: .06em; color: var(--fg-muted); font-weight: 600; margin-bottom: .2em; }
.gh-table { width: auto; font-size: .9em; }
.gh-table th, .gh-table td { padding: 5px 14px 5px 0; }
.gh-table-cap { caption-side: top; text-align: left; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .9em; font-weight: 600; color: var(--accent); padding-bottom: 6px; }
.gh-docstring { margin: .5em 0 .5em 14px; }
`

/* ── .design rendering ──────────────────────────────────────────────────────
 *
 * A .design file is a crisp decision note (a line-per-line Y-statement): a
 * small fixed keyword vocabulary, one clause per line, rendered hierarchically
 * with color-coded keywords like Gherkin. Keywords:
 *   Context:  the forces (given)        Because: the load-bearing rationale
 *   Choose:   the decision              So:      the consequences
 *   Over:     alternatives rejected     Not:     non-goals
 * Plus `Key: value` metadata rows (Status, Backs, …) and ```mermaid blocks.
 */

const DESIGN_META = new Set(["Status", "Backs", "Lineage", "Owner", "Date", "Supersedes"])
const DESIGN_SECTIONS: Record<string, string> = {
	Context: "ds-context",
	Choose: "ds-choose",
	Over: "ds-over",
	Because: "ds-because",
	So: "ds-so",
	Not: "ds-not",
}

function designClause(text: string): string {
	let s = escapeHtml(text)
	s = s.replace(/`([^`]+)`/g, "<code>$1</code>")
	return s
}

function renderDesignToBody(src: string): { body: string; title: string } {
	const lines = src.replace(/\r/g, "").split("\n")
	let title = "design"
	const parts: string[] = []
	let clauses: string[] = []
	const flush = () => {
		if (clauses.length) {
			parts.push(
				`<ul class="ds-clauses">${clauses.map((c) => `<li>${c}</li>`).join("")}</ul>`,
			)
			clauses = []
		}
	}
	let i = 0
	while (i < lines.length) {
		const t = lines[i].trim()
		if (t.startsWith("```mermaid")) {
			flush()
			const buf: string[] = []
			i++
			while (i < lines.length && lines[i].trim() !== "```") {
				buf.push(lines[i])
				i++
			}
			i++
			const { svg, error } = renderMermaidBlock(buf.join("\n"))
			parts.push(
				error
					? `<pre class="mermaid-error"><code>${escapeHtml(error)}</code></pre>`
					: `<figure class="mermaid-svg">${svg}</figure>`,
			)
			continue
		}
		if (t.startsWith("# ")) {
			flush()
			title = t.slice(2).trim()
			parts.push(`<h1 class="ds-title">${escapeHtml(title)}</h1>`)
			i++
			continue
		}
		if (t === "") {
			flush()
			i++
			continue
		}
		if (t.startsWith("- ")) {
			clauses.push(designClause(t.slice(2)))
			i++
			continue
		}
		const m = t.match(/^([A-Za-z][A-Za-z ]*?):\s*(.*)$/)
		if (m) {
			const kw = m[1].trim()
			const rest = m[2]
			const base = kw.split(" ")[0]
			if (DESIGN_META.has(kw)) {
				flush()
				parts.push(
					`<div class="ds-meta"><span class="ds-meta-k">${escapeHtml(kw)}</span> <span class="ds-meta-v">${designClause(rest)}</span></div>`,
				)
				i++
				continue
			}
			if (DESIGN_SECTIONS[base]) {
				flush()
				parts.push(
					`<div class="ds-section"><span class="ds-kw ${DESIGN_SECTIONS[base]}">${escapeHtml(kw)}</span>${rest ? ` <span class="ds-subtitle">${designClause(rest)}</span>` : ""}</div>`,
				)
				i++
				continue
			}
		}
		flush()
		parts.push(`<p class="ds-prose">${designClause(t)}</p>`)
		i++
	}
	flush()
	return { body: parts.join("\n"), title }
}

const DESIGN_EXTRA_STYLES = `
:root { --ds-blue: #3b6fb0; --ds-green: #3a8c5a; --ds-red: #b3452f; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ds-blue: #82aaff; --ds-green: #7bc089; --ds-red: #ef6b73; } }
:root[data-theme="dark"] { --ds-blue: #82aaff; --ds-green: #7bc089; --ds-red: #ef6b73; }
.ds-title { margin: 0 0 .4em; }
.ds-meta { font: 12.5px/1.7 ui-monospace, "SF Mono", Menlo, monospace; color: var(--fg-muted); }
.ds-meta-k { color: var(--fg-quiet); display: inline-block; min-width: 5em; }
.ds-section { margin: 1.6em 0 .3em; }
.ds-kw { font-weight: 700; font-size: 1.05em; letter-spacing: -.01em; }
.ds-context { color: var(--ds-blue); }
.ds-choose { color: var(--accent); }
.ds-because { color: var(--accent); }
.ds-over { color: var(--fg-muted); }
.ds-so { color: var(--ds-green); }
.ds-not { color: var(--ds-red); }
.ds-subtitle { color: var(--fg-muted); font-weight: 400; }
.ds-clauses { list-style: none; padding-left: 1.2em; margin: .2em 0 .2em; }
.ds-clauses li { position: relative; padding: .12em 0; line-height: 1.55; }
.ds-clauses li::before { content: ""; position: absolute; left: -1.1em; top: .9em; width: .55em; border-top: 1px solid var(--border-strong); }
.ds-prose { color: var(--fg-muted); margin: .5em 0; }
`

async function renderToHtml(src: string, opts: { embed?: boolean; format?: "markdown" | "yaml" | "gherkin" | "design" } = {}): Promise<string> {
	const format = opts.format ?? "markdown"

	let title: string
	let bodyHtml: string
	let fmBlock = ""

	if (format === "yaml") {
		const { body, title: t } = await renderYamlToBody(src)
		bodyHtml = body
		title = t.replace(/</g, "&lt;")
	} else if (format === "gherkin") {
		const { body, title: t } = renderFeatureToBody(src)
		bodyHtml = body
		title = t.replace(/</g, "&lt;")
	} else if (format === "design") {
		const { body, title: t } = renderDesignToBody(src)
		bodyHtml = body
		title = t.replace(/</g, "&lt;")
	} else {
		const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n/)
		const fm = fmMatch ? fmMatch[1] : ""
		const body = fmMatch ? src.slice(fmMatch[0].length) : src

		bodyHtml = await marked.parse(body)

		const fmTitle = fm.match(/^title:\s*(.+)$/m)?.[1]?.trim()
		const h1Title = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
		title = (fmTitle ?? h1Title ?? "doc").replace(/</g, "&lt;")
		fmBlock = fm
			? `<div class="frontmatter">${fm.replace(/</g, "&lt;")}</div>`
			: ""
	}

	const rendered = bodyHtml

	const embedStyle = opts.embed
		? `<style>.theme-toggle{display:none}body{background:transparent}</style>`
		: ""

	const yamlStyles = format === "yaml" ? `<style>${YAML_EXTRA_STYLES}</style>` : ""
	const gherkinStyles = format === "gherkin" ? `<style>${GHERKIN_EXTRA_STYLES}</style>` : ""
	const designStyles = format === "design" ? `<style>${DESIGN_EXTRA_STYLES}</style>` : ""

	return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<script>${PRE_THEME_SCRIPT}</script>
<style>${styles}</style>${yamlStyles}${gherkinStyles}${designStyles}${embedStyle}
</head><body>
${themeToggle}
${fmBlock}
${rendered}
<script>${copyButton}</script>
</body></html>`
}

function detectFormat(path: string): "markdown" | "yaml" | "gherkin" | "design" {
	const ext = extname(path).toLowerCase()
	if (ext === ".yaml" || ext === ".yml") return "yaml"
	if (ext === ".feature") return "gherkin"
	if (ext === ".design") return "design"
	return "markdown"
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
				const html = await renderToHtml(src, { embed, format: detectFormat(inputPath) })
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
	const format = detectFormat(inputPath)
	if (format === "markdown") {
		const issues = validateMermaidBlocks(src)
		if (issues.length) {
			console.error(`mermaid validation failed (${issues.length} issue${issues.length > 1 ? "s" : ""}):`)
			for (const it of issues) console.error(`  block #${it.index}: ${it.message}`)
			process.exit(1)
		}
	}
	const html = await renderToHtml(src, { format })
	writeFileSync(outPath, html)
	console.log(outPath)
}
