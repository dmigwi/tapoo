import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(scriptDirectory, "..")
const templatesDirectory = path.join(rootDirectory, "frontend", "templates")
const publicDirectory = path.join(rootDirectory, "public")

async function readTemplate(name) {
  return readFile(path.join(templatesDirectory, name), "utf8")
}

function render(template, values) {
  return template.replaceAll(/{{([a-zA-Z0-9]+)}}/g, (_, key) => {
    if (!(key in values)) {
      throw new Error(`Missing template value: ${key}`)
    }

    return values[key]
  })
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function indentHtml(html, indent) {
  return html.trimEnd().replaceAll("\n", `\n${indent}`)
}

async function buildPage(layout, sharedPartials, page) {
  const html = render(layout, {
    ...sharedPartials,
    ...page,
    pageContent: indentHtml(await readTemplate(page.pageContent), "      "),
    primaryMenuItem: indentHtml(await readTemplate(page.primaryMenuItem), "            "),
  })

  await writeFile(path.join(publicDirectory, page.output), html)
}

const layout = await readTemplate("_main-template.html")
const sharedPartials = {
  contactLink: indentHtml(await readTemplate("contact-link.html"), "            "),
  placeholderArt: indentHtml(await readTemplate("placeholder-art.html"), "      "),
  privacyLink: indentHtml(await readTemplate("nav-privacy-link.html"), "            "),
  topMenuSummary: indentHtml(await readTemplate("top-menu-summary.html"), "          "),
}
const gameScriptTags = indentHtml(
  [
    '<script defer src="./js/page-chrome.min.js"></script>',
    '<script defer src="./js/tapoo.min.js"></script>',
  ].join("\n"),
  "    ",
)
const staticPageScriptTags = indentHtml(
  '<script defer src="./js/page-chrome.min.js"></script>',
  "    ",
)

await mkdir(publicDirectory, { recursive: true })

await Promise.all([
  buildPage(layout, sharedPartials, {
    bodyAttributes: 'data-tapoo-control-mode="interactive"',
    canonicalUrl: "https://dmigwi.github.io/tapoo/",
    descriptionConfigKey: "pages.game.description",
    descriptionText: escapeHtml(
      "Tapoo maze runner hide and seek game rendered as a browser-based terminal experience.",
    ),
    output: "index.html",
    pageContent: "terminal-section.html",
    pageLabelConfigKey: "pages.game.pageLabel",
    primaryMenuItem: "nav-agents-link.html",
    scriptTags: gameScriptTags,
    titleConfigKey: "pages.game.documentTitle",
    titleText: escapeHtml("Tapoo Maze Runner | Game"),
  }),
  buildPage(layout, sharedPartials, {
    bodyAttributes: 'data-tapoo-control-mode="agent-api"',
    canonicalUrl: "https://dmigwi.github.io/tapoo/agents.html",
    descriptionConfigKey: "pages.agents.description",
    descriptionText: escapeHtml(
      "Tapoo maze runner played by an HTTP-driven agent with human session controls.",
    ),
    output: "agents.html",
    pageContent: "terminal-section.html",
    pageLabelConfigKey: "pages.agents.pageLabel",
    primaryMenuItem: "nav-game-link.html",
    scriptTags: gameScriptTags,
    titleConfigKey: "pages.agents.documentTitle",
    titleText: escapeHtml("Tapoo Maze Runner | AI Agents"),
  }),
  buildPage(layout, {
    ...sharedPartials,
    placeholderArt: "",
  }, {
    bodyAttributes: "",
    canonicalUrl: "https://dmigwi.github.io/tapoo/privacy.html",
    descriptionConfigKey: "pages.privacy.description",
    descriptionText: escapeHtml(
      "Privacy details for Tapoo browser storage and optional AI Agent API gameplay context.",
    ),
    output: "privacy.html",
    pageContent: "privacy-section.html",
    pageLabelConfigKey: "pages.privacy.pageLabel",
    primaryMenuItem: "nav-game-link.html",
    scriptTags: staticPageScriptTags,
    titleConfigKey: "pages.privacy.documentTitle",
    titleText: escapeHtml("Tapoo Maze Runner | Privacy"),
  }),
])
