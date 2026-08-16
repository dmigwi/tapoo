import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(scriptDirectory, "..")
const templatesDirectory = path.join(rootDirectory, "frontend", "templates")
const publicDirectory = path.join(rootDirectory, "public")
const stylesheetHref = process.env.TAPOO_STYLESHEET_HREF ?? "./css/tapoo.min.css"
const tapooScriptSrc = process.env.TAPOO_SCRIPT_SRC ?? "./js/tapoo.min.js"

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

// renderPromptSections compiles the prompt builders and runs them here, at build time, so the
// prompts page can ship as plain HTML with no bundle of its own. The content is derived entirely
// from constants — the system prompt, the tool descriptions and the response schema never vary at
// runtime — and sourcing it from the same module the agent runtime calls keeps the published page
// from drifting away from what is actually sent.
async function renderPromptSections() {
  const bundled = await build({
    entryPoints: [path.join(rootDirectory, "frontend", "app", "prompt-preview.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "es2022",
  })

  // Imported from memory rather than a temp file so the build leaves nothing behind to clean up.
  const source = Buffer.from(bundled.outputFiles[0].text).toString("base64")
  const { buildPreviewSections, previewPlayerNote } = await import(
    `data:text/javascript;base64,${source}`
  )

  // Only the tags are indented. The bodies are left flush against column zero because <pre>
  // preserves whitespace: indenting them would push every line of the prompt text to the right
  // in the rendered page, which is what makes generated blocks different from ordinary markup.
  const indent = " ".repeat(8)
  const sections = buildPreviewSections()
    .map(
      (section) =>
        `${indent}<h2 class="prompt-preview__heading">${escapeHtml(section.heading)}</h2>\n` +
        `${indent}<pre class="prompt-preview__block">${escapeHtml(section.body)}</pre>`,
    )
    .join("\n")

  return { promptPlayerNote: escapeHtml(previewPlayerNote()), promptBlocks: sections }
}

// promptBlocksSlot is an HTML comment rather than a {{token}} so it survives render() untouched and
// can be filled after the page-wide indent pass. The leading whitespace is consumed with it, since
// the blocks bring their own indentation.
const promptBlocksSlot = /[ \t]*<!--prompt-blocks-->/

async function buildPage(layout, sharedPartials, page) {
  // The page's own template is rendered first: values inserted into the layout are not scanned
  // again, so a placeholder inside pageContent would otherwise survive into the output verbatim.
  const rendered = render(await readTemplate(page.pageContent), page)
  const pageContent = indentHtml(rendered, "      ").replace(
    promptBlocksSlot,
    page.promptBlocks ?? "",
  )

  const html = render(layout, {
    ...sharedPartials,
    ...page,
    pageContent,
    stylesheetHref,
    primaryMenuItem: indentHtml(await readTemplate(page.primaryMenuItem), "            "),
    // Only the agent page has prompts to show, so every other page leaves the slot empty.
    promptsLink: page.promptsLink
      ? indentHtml(await readTemplate(page.promptsLink), "            ")
      : "",
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
const scriptTags = indentHtml(`<script defer src="${tapooScriptSrc}"></script>`, "    ",)

const promptContent = await renderPromptSections()
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
    scriptTags,
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
    promptsLink: "nav-prompts-link.html",
    scriptTags,
    titleConfigKey: "pages.agents.documentTitle",
    titleText: escapeHtml("Tapoo Maze Runner | AI Agents"),
  }),
  buildPage(layout, {
    ...sharedPartials,
    placeholderArt: "",
  }, {
    bodyAttributes: "",
    canonicalUrl: "https://dmigwi.github.io/tapoo/prompts.html",
    descriptionConfigKey: "pages.prompts.description",
    descriptionText: escapeHtml(
      "The exact system prompt, user message, tool definitions and response format Tapoo sends to a configured AI agent.",
    ),
    ...promptContent,
    output: "prompts.html",
    pageContent: "prompts-section.html",
    pageLabelConfigKey: "pages.prompts.pageLabel",
    // The prompts page is reached from the agents page, so its back link returns there.
    primaryMenuItem: "nav-agents-back-link.html",
    scriptTags,
    titleConfigKey: "pages.prompts.documentTitle",
    titleText: escapeHtml("Tapoo Maze Runner | Agent Prompts"),
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
    scriptTags,
    titleConfigKey: "pages.privacy.documentTitle",
    titleText: escapeHtml("Tapoo Maze Runner | Privacy"),
  }),
])
