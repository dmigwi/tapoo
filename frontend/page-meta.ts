import { CONFIG } from "./app/config"
import { APP_VERSION } from "./app/version"

declare const __TAPOO_BUILD_YEAR__: number

function configText(key: string): string {
  const value = CONFIG[key as keyof typeof CONFIG]
  if (typeof value !== "string") {
    throw new Error(`missing translatable config entry: ${key}`)
  }

  return value
}

function applyConfigAttribute(
  selector: string,
  attributeName: "aria-label" | "content" | "textContent",
): void {
  const nodes = document.querySelectorAll<HTMLElement>(selector)

  for (const node of nodes) {
    const configKey = node.dataset.configKey
    if (!configKey) {
      continue
    }

    const value = configText(configKey)
    if (attributeName === "textContent") {
      node.textContent = value
      continue
    }

    node.setAttribute(attributeName, value)
  }
}

function applyDocumentTitle(): void {
  const titleElement = document.querySelector("title[data-config-key]")
  if (!(titleElement instanceof HTMLTitleElement)) {
    return
  }

  const configKey = titleElement.dataset.configKey
  if (!configKey) {
    return
  }

  const value = configText(configKey)
  titleElement.textContent = value
  document.title = value
}

// applyPageVersion keeps shared page chrome in sync with the semantic version injected at build time.
function applyPageVersion(): void {
  const versionCopies = document.querySelectorAll<HTMLElement>("[data-page-version]")
  for (const element of versionCopies) {
    element.textContent = CONFIG.pageVersionTemplate
      .replace("{version}", APP_VERSION)
      .replace("{year}", String(__TAPOO_BUILD_YEAR__))
  }
}

function applyPageText(): void {
  applyDocumentTitle()
  applyConfigAttribute("[data-config-text]", "textContent")
  applyConfigAttribute("[data-config-aria-label]", "aria-label")
  applyConfigAttribute("meta[data-config-key]", "content")
}

applyPageText()
applyPageVersion()
