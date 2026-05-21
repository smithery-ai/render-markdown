// Adds a "copy" icon to every <pre> block in the preview.
// Stays hidden until the user hovers the block.
(function () {
  const icon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
  const check = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`

  function attach(pre) {
    if (pre.dataset.copyWired) return
    pre.dataset.copyWired = "1"
    pre.classList.add("has-copy")
    const btn = document.createElement("button")
    btn.className = "copy-btn"
    btn.type = "button"
    btn.setAttribute("aria-label", "Copy")
    btn.innerHTML = icon
    btn.addEventListener("click", async () => {
      const code = pre.querySelector("code")
      const text = (code ? code.innerText : pre.innerText).replace(/\n$/, "")
      try {
        await navigator.clipboard.writeText(text)
        btn.innerHTML = check
        btn.classList.add("copied")
        clearTimeout(btn._t)
        btn._t = setTimeout(() => {
          btn.innerHTML = icon
          btn.classList.remove("copied")
        }, 1200)
      } catch (_) { /* user denied / non-https / no permission */ }
    })
    pre.appendChild(btn)
  }

  // Skip mermaid blocks — they get replaced with SVGs.
  document.querySelectorAll("pre:not(.mermaid)").forEach(attach)
})();
