import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"

const forced = document.documentElement.dataset.theme
const dark = forced === "dark" || (!forced && window.matchMedia("(prefers-color-scheme: dark)").matches)

const lightVars = {
  fontFamily: "ui-monospace, monospace",
  primaryColor: "#f3e6d0",
  primaryBorderColor: "#b8521a",
  primaryTextColor: "#2a1c0e",
  lineColor: "#8a3a0e",
}
const darkVars = {
  fontFamily: "ui-monospace, monospace",
  background: "#14110d",
  primaryColor: "#1f1a13",
  primaryBorderColor: "#e89060",
  primaryTextColor: "#ede4d3",
  lineColor: "#e89060",
  secondaryColor: "#2a221a",
  tertiaryColor: "#1a1611",
}

mermaid.initialize({
  startOnLoad: true,
  theme: dark ? "dark" : "default",
  themeVariables: dark ? darkVars : lightVars,
})
