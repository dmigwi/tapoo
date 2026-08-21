import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
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

// subresourceIntegrity hashes an already-built file's actual bytes for a Subresource Integrity
// attribute. Unlike a CSP script-src/style-src hash — which only ever gates inline <script>/<style>
// content — integrity="..." is the mechanism that applies to externally-loaded files: the browser
// refuses to execute or apply the resource at all if its fetched bytes don't match this hash,
// which a plain CSP entry can't enforce for external sources regardless of what's listed in it.
async function subresourceIntegrity(filePath) {
  const content = await readFile(filePath)
  return `sha384-${createHash("sha384").update(content).digest("base64")}`
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

// lastCommitDate returns the ISO timestamp of the most recent commit touching any of the given
// paths (relative to rootDirectory), so JSON-LD's dateModified reflects real content history
// rather than a build-time stamp that would change on every rebuild regardless of whether
// anything the page actually shows changed.
function lastCommitDate(...paths) {
  return execFileSync("git", ["log", "-1", "--format=%cI", "--", ...paths], {
    cwd: rootDirectory,
    encoding: "utf8",
  }).trim()
}

// Byte offsets within the 32-byte digest — one contiguous run: 4 timestamp bytes, then the
// storage-encoding prefix string (e.g. "tapoo:v4.5:") padded to a fixed width, then 3 app-version
// bytes (major/minor/patch).
const DATA_BUILD_KEY_TIME_OFFSET = 11
const DATA_BUILD_KEY_PREFIX_OFFSET = DATA_BUILD_KEY_TIME_OFFSET + 4
const DATA_BUILD_KEY_PREFIX_LENGTH = 12
const DATA_BUILD_KEY_VERSION_OFFSET = DATA_BUILD_KEY_PREFIX_OFFSET + DATA_BUILD_KEY_PREFIX_LENGTH

// dataBuildKey computes a version-stamp value from a constant already defined in the app
// (storage.ts's blend key) rather than from git, so the build doesn't depend on the git binary
// being available. The base hash is derived only from that one fixed, always-known constant —
// never from anything that varies release to release — so confirming any value later means
// recomputing this one hash, not searching through past release combinations.
//
// The storage-encoding prefix, app version, and build timestamp are combined directly into a
// fixed byte range of that hash via XOR before hex-encoding, rather than hashed away as input — a
// one-way hash can't have information extracted back out that was only ever used to produce it, so
// this keeps them recoverable exactly with the same fixed key. The prefix is kept as its full
// literal string (e.g. "tapoo:v4.5:"), not just the bare version number, so a decode is
// self-describing on its own rather than a number with no visible context — padded to a fixed
// width with trailing spaces (not a punctuation character) since it isn't always the same length,
// so the padding reads as ordinary trailing whitespace rather than something needing an
// explanation.
function dataBuildKey(blendKey, storageEncodingPrefix, appVersion) {
  const digest = createHash("sha256").update(blendKey).digest()

  const timeBytes = Buffer.alloc(4)
  timeBytes.writeUInt32BE(Math.floor(Date.now() / 1000))

  const prefixBytes = Buffer.alloc(DATA_BUILD_KEY_PREFIX_LENGTH, " ")
  Buffer.from(storageEncodingPrefix, "ascii").copy(prefixBytes)

  const [major, minor, patch] = appVersion.split(".").map(Number)
  const versionBytes = Buffer.from([major, minor, patch])

  for (let i = 0; i < timeBytes.length; i++) {
    digest[DATA_BUILD_KEY_TIME_OFFSET + i] ^= timeBytes[i]
  }
  for (let i = 0; i < prefixBytes.length; i++) {
    digest[DATA_BUILD_KEY_PREFIX_OFFSET + i] ^= prefixBytes[i]
  }
  for (let i = 0; i < versionBytes.length; i++) {
    digest[DATA_BUILD_KEY_VERSION_OFFSET + i] ^= versionBytes[i]
  }

  return digest.toString("hex")
}

// buildStructuredData renders a schema.org JSON-LD block as a @graph of two nodes: the site-wide
// WebSite identity (shared, by @id, across every page) and the page's own entity, linked to it via
// isPartOf. Values are JSON.stringify-escaped rather than HTML-escaped: the surrounding <script
// type="application/ld+json"> is a raw-text element, so HTML entities placed in it (e.g. &quot;)
// are never decoded and would corrupt the JSON.
function buildStructuredData({ website, type, name, description, url, extra = {} }) {
  const page = {
    "@type": type,
    "@id": `${url}#webpage`,
    isPartOf: { "@id": website["@id"] },
    name,
    description,
    url,
    ...extra,
  }

  return JSON.stringify(
    { "@context": "https://schema.org", "@graph": [website, page] },
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
  return import(`data:text/javascript;base64,${source}`)
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
    // Only prompts.html and privacy.html need a second back-link (the other one-hop-away
    // destination they don't already reach via primaryMenuItem); every other page leaves it empty.
    secondaryMenuItem: page.secondaryMenuItem
      ? indentHtml(await readTemplate(page.secondaryMenuItem), "            ")
      : "",
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

// esbuild has already written these files by the time this script runs (build-frontend.sh runs it
// last), so their on-disk bytes are the exact ones the browser will fetch.
const stylesheetIntegrity = await subresourceIntegrity(
  path.join(publicDirectory, stylesheetHref.replace(/^\.\//, "")),
)
const scriptIntegrity = await subresourceIntegrity(
  path.join(publicDirectory, tapooScriptSrc.replace(/^\.\//, "")),
)
sharedPartials.stylesheetIntegrity = stylesheetIntegrity
const scriptTags = indentHtml(
  `<script defer src="${tapooScriptSrc}" integrity="${scriptIntegrity}"></script>`,
  "    ",
)

const promptContent = await renderPromptSections()
const {
  CONFIG: runtimeConfig,
  APP_VERSION,
  STORE_BLEND_KEY,
  STORE_ENCODING_PREFIX,
} = await loadRuntimeConfig()
const { controlModes, siteUrl: urlPath, author } = runtimeConfig.runtime
const { game, agents, prompts, privacy } = runtimeConfig.pages
await mkdir(publicDirectory, { recursive: true })

// og-image.png/.svg are static, hand-authored assets under public/images (like favicon.svg), not
// build output — only the URL that points at them is computed here.
const ogImageUrl = `${urlPath}images/og-image.png`
sharedPartials.ogImageUrl = ogImageUrl
sharedPartials.dataBuildKey = dataBuildKey(STORE_BLEND_KEY, STORE_ENCODING_PREFIX, APP_VERSION)

const website = {
  "@type": "WebSite",
  "@id": `${urlPath}#website`,
  name: "Tapoo — AI agent behavior profiler",
  description: "Measures an agent's strategy execution under uncertainty.",
  url: urlPath,
  image: ogImageUrl,
  author: { "@type": "Person", name: author.name, sameAs: author.profileUrl },
}

// Titles and descriptions are read from CONFIG.pages rather than duplicated here, so this static
// HTML can never drift from the text page-chrome.ts's applyPageText() hydrates the same elements
// with once client-side JS runs.
const gameTitle = game.documentTitle
const gameDescription = game.description
const agentsTitle = agents.documentTitle
const agentsDescription = agents.description
const promptsTitle = prompts.documentTitle
const promptsDescription = prompts.description
const privacyTitle = privacy.documentTitle
const privacyDescription = privacy.description
const agentsUrl = `${urlPath}agents.html`
const promptsUrl = `${urlPath}prompts.html`
const privacyUrl = `${urlPath}privacy.html`

// dateModified per page: the layout and frontend/app/config.ts affect every page's rendered
// content and copy, so both are included in every call; each page's own content template is
// added on top, plus prompt-preview.ts for prompts.html since renderPromptSections derives that
// page's body from it directly.
const sharedContentPaths = ["frontend/templates/_main-template.html", "frontend/app/config.ts"]
const gameDateModified = lastCommitDate(...sharedContentPaths, "frontend/templates/terminal-section.html")
const agentsDateModified = gameDateModified
const promptsDateModified = lastCommitDate(
  ...sharedContentPaths,
  "frontend/templates/prompts-section.html",
  "frontend/app/prompt-preview.ts",
)
const privacyDateModified = lastCommitDate(...sharedContentPaths, "frontend/templates/privacy-section.html")

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
        website,
        type: "WebApplication",
        name: gameTitle,
        description: gameDescription,
        url: urlPath,
        extra: {
          applicationCategory: "AI Agent Behavior Profiler Tool",
          operatingSystem: "Any",
          browserRequirements: "Requires JavaScript",
          softwareVersion: APP_VERSION,
          dateModified: gameDateModified,
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
        website,
        type: "WebApplication",
        name: agentsTitle,
        description: agentsDescription,
        url: agentsUrl,
        extra: {
          applicationCategory: "AI Agent Behavior Profiler Tool",
          operatingSystem: "Any",
          browserRequirements: "Requires JavaScript",
          softwareVersion: APP_VERSION,
          dateModified: agentsDateModified,
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
    secondaryMenuItem: "nav-game-link.html",
    structuredData: indentHtml(
      buildStructuredData({
        website,
        type: "WebPage",
        name: promptsTitle,
        description: promptsDescription,
        url: promptsUrl,
        extra: { dateModified: promptsDateModified },
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
    secondaryMenuItem: "nav-agents-back-link.html",
    structuredData: indentHtml(
      buildStructuredData({
        website,
        type: "WebPage",
        name: privacyTitle,
        description: privacyDescription,
        url: privacyUrl,
        extra: { dateModified: privacyDateModified },
      }),
      "      ",
    ),
    titleConfigKey: "pages.privacy.documentTitle",
    titleText: escapeHtml(privacyTitle),
  }),
  writeSitemap([urlPath, agentsUrl, promptsUrl, privacyUrl]),
  writeRobotsTxt(),
])
