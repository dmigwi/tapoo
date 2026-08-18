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

// buildStructuredData renders a schema.org JSON-LD block. Values are JSON.stringify-escaped rather
// than HTML-escaped: the surrounding <script type="application/ld+json"> is a raw-text element, so
// HTML entities placed in it (e.g. &quot;) are never decoded and would corrupt the JSON.
function buildStructuredData({ type, name, description, url, extra = {} }) {
  return JSON.stringify(
    { "@context": "https://schema.org", "@type": type, name, description, url, ...extra },
    null,
    2,
  )
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

// loadRuntimeConfig bundles and imports the real config module, the same way renderPromptSections
// does for the prompt builders, so values baked into the static HTML (like the control-mode body
// attribute) can never drift from what frontend/app/config.ts actually defines.
async function loadRuntimeConfig() {
  const bundled = await build({
    entryPoints: [path.join(rootDirectory, "frontend", "app", "config.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "es2022",
  })

  const source = Buffer.from(bundled.outputFiles[0].text).toString("base64")
  const { CONFIG } = await import(`data:text/javascript;base64,${source}`)
  return CONFIG
}

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

// writeSitemap and writeRobotsTxt are derived from the same urlPath used for each page's
// canonicalUrl, so the crawl-facing site map can never list a URL that drifts from what the pages
// themselves declare as canonical.
async function writeSitemap(urls) {
  const entries = urls.map((url) => `  <url>\n    <loc>${url}</loc>\n  </url>`).join("\n")
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`

  await writeFile(path.join(publicDirectory, "sitemap.xml"), xml)
}

async function writeRobotsTxt() {
  const contents = `User-agent: *\nAllow: /\n\nSitemap: ${urlPath}sitemap.xml\n`
  await writeFile(path.join(publicDirectory, "robots.txt"), contents)
}

const layout = await readTemplate("_main-template.html")
const sharedPartials = {
  contactLink: indentHtml(await readTemplate("contact-link.html"), "            "),
  placeholderArt: indentHtml(await readTemplate("placeholder-art.html"), "      "),
  privacyLink: indentHtml(await readTemplate("nav-privacy-link.html"), "            "),
  topMenuSummary: indentHtml(await readTemplate("top-menu-summary.html"), "          "),
}
const scriptTags = indentHtml(`<script defer src="${tapooScriptSrc}"></script>`, "    ",)

const urlPath = "https://dmigwi.github.io/tapoo/"
const promptContent = await renderPromptSections()
const { controlModes } = (await loadRuntimeConfig()).runtime
await mkdir(publicDirectory, { recursive: true })

const gameTitle = "Tapoo Maze Runner | Game"
const gameDescription =
  "Tapoo maze runner hide and seek game rendered as a browser-based terminal experience."
const agentsTitle = "Tapoo Maze Runner | AI Agents"
const agentsDescription =
  "Tapoo maze runner played by an HTTP-driven agent with human session controls."
const promptsTitle = "Tapoo Maze Runner | Agent Prompts"
const promptsDescription =
  "The exact system prompt, user message, tool definitions and response format Tapoo sends to a configured AI agent."
const privacyTitle = "Tapoo Maze Runner | Privacy"
const privacyDescription =
  "Privacy details for Tapoo browser storage and optional AI Agent API gameplay context."
const agentsUrl = `${urlPath}agents.html`
const promptsUrl = `${urlPath}prompts.html`
const privacyUrl = `${urlPath}privacy.html`

await Promise.all([
  buildPage(layout, sharedPartials, {
    bodyAttributes: ` data-tapoo-control-mode="${escapeHtml(controlModes.interactive)}"`,
    canonicalUrl: urlPath,
    descriptionConfigKey: "pages.game.description",
    descriptionText: escapeHtml(gameDescription),
    output: "index.html",
    pageContent: "terminal-section.html",
    pageLabelConfigKey: "pages.game.pageLabel",
    primaryMenuItem: "nav-agents-link.html",
    scriptTags,
    structuredData: indentHtml(
      buildStructuredData({
        type: "WebApplication",
        name: gameTitle,
        description: gameDescription,
        url: urlPath,
        extra: {
          applicationCategory: "GameApplication",
          operatingSystem: "Any",
          browserRequirements: "Requires JavaScript",
        },
      }),
      "      ",
    ),
    titleConfigKey: "pages.game.documentTitle",
    titleText: escapeHtml(gameTitle),
  }),
  buildPage(layout, sharedPartials, {
    bodyAttributes: ` data-tapoo-control-mode="${escapeHtml(controlModes.agentApi)}"`,
    canonicalUrl: agentsUrl,
    descriptionConfigKey: "pages.agents.description",
    descriptionText: escapeHtml(agentsDescription),
    output: "agents.html",
    pageContent: "terminal-section.html",
    pageLabelConfigKey: "pages.agents.pageLabel",
    primaryMenuItem: "nav-game-link.html",
    promptsLink: "nav-prompts-link.html",
    scriptTags,
    structuredData: indentHtml(
      buildStructuredData({
        type: "WebApplication",
        name: agentsTitle,
        description: agentsDescription,
        url: agentsUrl,
        extra: {
          applicationCategory: "GameApplication",
          operatingSystem: "Any",
          browserRequirements: "Requires JavaScript",
        },
      }),
      "      ",
    ),
    titleConfigKey: "pages.agents.documentTitle",
    titleText: escapeHtml(agentsTitle),
  }),
  buildPage(layout, {
    ...sharedPartials,
    placeholderArt: "",
  }, {
    bodyAttributes: "",
    canonicalUrl: promptsUrl,
    descriptionConfigKey: "pages.prompts.description",
    descriptionText: escapeHtml(promptsDescription),
    ...promptContent,
    output: "prompts.html",
    pageContent: "prompts-section.html",
    pageLabelConfigKey: "pages.prompts.pageLabel",
    // The prompts page is reached from the agents page, so its back link returns there.
    primaryMenuItem: "nav-agents-back-link.html",
    scriptTags,
    structuredData: indentHtml(
      buildStructuredData({
        type: "WebPage",
        name: promptsTitle,
        description: promptsDescription,
        url: promptsUrl,
      }),
      "      ",
    ),
    titleConfigKey: "pages.prompts.documentTitle",
    titleText: escapeHtml(promptsTitle),
  }),
  buildPage(layout, {
    ...sharedPartials,
    placeholderArt: "",
  }, {
    bodyAttributes: "",
    canonicalUrl: privacyUrl,
    descriptionConfigKey: "pages.privacy.description",
    descriptionText: escapeHtml(privacyDescription),
    output: "privacy.html",
    pageContent: "privacy-section.html",
    pageLabelConfigKey: "pages.privacy.pageLabel",
    primaryMenuItem: "nav-game-link.html",
    scriptTags,
    structuredData: indentHtml(
      buildStructuredData({
        type: "WebPage",
        name: privacyTitle,
        description: privacyDescription,
        url: privacyUrl,
      }),
      "      ",
    ),
    titleConfigKey: "pages.privacy.documentTitle",
    titleText: escapeHtml(privacyTitle),
  }),
  writeSitemap([urlPath, agentsUrl, promptsUrl, privacyUrl]),
  writeRobotsTxt(),
])
