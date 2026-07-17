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
  topMenuSummary: indentHtml(await readTemplate("top-menu-summary.html"), "          "),
}

await mkdir(publicDirectory, { recursive: true })

await Promise.all([
  buildPage(layout, sharedPartials, {
    bodyAttributes: 'data-tapoo-control-mode="interactive"',
    descriptionConfigKey: "pages.game.description",
    output: "index.html",
    pageContent: "terminal-section.html",
    pageLabelConfigKey: "pages.game.pageLabel",
    primaryMenuItem: "nav-agents-link.html",
    titleConfigKey: "pages.game.documentTitle",
  }),
  buildPage(layout, sharedPartials, {
    bodyAttributes: 'data-tapoo-control-mode="agent-api"',
    descriptionConfigKey: "pages.agents.description",
    output: "agents.html",
    pageContent: "terminal-section.html",
    pageLabelConfigKey: "pages.agents.pageLabel",
    primaryMenuItem: "nav-game-link.html",
    titleConfigKey: "pages.agents.documentTitle",
  }),
])
