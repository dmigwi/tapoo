import { CONFIG, PAGE_COPYRIGHT_TEXT } from "./app/config"
import { showPlaceholderArt } from "./app/fallback-policy"
import {
  compactChromeClass,
  isCompactViewport,
  observeCompactViewportChanges,
  wideChromeClass,
} from "./app/viewport"

// configValue resolves a dotted CONFIG path and rejects missing segments early.
function configValue(path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((currentValue, pathSegment) => {
      if (
        typeof currentValue !== "object" ||
        currentValue === null ||
        !(pathSegment in currentValue)
      ) {
        throw new Error(`missing config entry: ${path}`)
      }

      return currentValue[pathSegment as keyof typeof currentValue]
    }, CONFIG)
}

// configText resolves a visible text entry from CONFIG and rejects non-string keys early.
function configText(key: string): string {
  const value = configValue(key)
  if (typeof value !== "string") {
    throw new Error(`missing translatable config entry: ${key}`)
  }

  return value
}

// applyConfigAttribute copies CONFIG-backed text into matching DOM attributes.
function applyConfigAttribute(
  selector: string,
  attributeName: "content" | "textContent",
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

// applyDocumentTitle keeps the live document title aligned with page metadata.
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

// applyPageVersion keeps shared page chrome in sync with the configured copyright text.
function applyPageVersion(): void {
  const versionCopies = document.querySelectorAll<HTMLElement>("[data-page-version]")
  for (const element of versionCopies) {
    element.textContent = PAGE_COPYRIGHT_TEXT
  }
}

// applyPageText hydrates shared static copy such as labels and meta descriptions.
function applyPageText(): void {
  applyDocumentTitle()
  applyConfigAttribute("[data-config-text]", "textContent")
  applyConfigAttribute("meta[data-config-key]", "content")
  document
    .querySelectorAll<HTMLInputElement>("[data-config-placeholder]")
    .forEach((input) => {
      const configKey = input.dataset.configPlaceholder
      if (!configKey) {
        return
      }

      input.placeholder = configText(configKey)
    })
  document
    .querySelectorAll<HTMLInputElement>("[data-config-value]")
    .forEach((input) => {
      const configKey = input.dataset.configValue
      if (!configKey) {
        return
      }

      input.defaultValue = configText(configKey)
      input.value = input.defaultValue
    })
}

// initTopMenus keeps shared top-bar menus expanded on wide screens and collapsible on compact ones.
function initTopMenus(): void {
  const menus = Array.from(document.querySelectorAll<HTMLDetailsElement>("details.top-menu"))
  let compactMode = false

  // syncChromeMode exposes the shared compact/wide page state to CSS for every page.
  function syncChromeMode(): void {
    compactMode = isCompactViewport()
    document.documentElement.classList.toggle(compactChromeClass, compactMode)
    document.documentElement.classList.toggle(wideChromeClass, !compactMode)
  }

  if (menus.length === 0) {
    syncChromeMode()
    observeCompactViewportChanges(syncChromeMode)
    return
  }

  // closeMenu hides one details menu without duplicating attribute writes.
  function closeMenu(menu: HTMLDetailsElement): void {
    menu.open = false
  }

  // syncMenuMode expands menus on wide screens and collapses them on compact ones.
  function syncMenuMode(): void {
    syncChromeMode()
    for (const menu of menus) {
      menu.open = !compactMode
    }
  }

  // closeOtherMenus preserves a single open menu in compact mode.
  function closeOtherMenus(activeMenu: HTMLDetailsElement): void {
    for (const menu of menus) {
      if (menu !== activeMenu) {
        closeMenu(menu)
      }
    }
  }

  for (const menu of menus) {
    menu.addEventListener("toggle", () => {
      if (compactMode && menu.open) {
        closeOtherMenus(menu)
      }
    })
  }

  document.addEventListener("click", (event: MouseEvent) => {
    if (!compactMode) {
      return
    }

    const target = event.target
    if (!(target instanceof Node)) {
      return
    }

    for (const menu of menus) {
      if (menu.open && !menu.contains(target)) {
        closeMenu(menu)
      }
    }
  })

  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (!compactMode) {
      return
    }

    if (event.key !== "Escape") {
      return
    }

    for (const menu of menus) {
      closeMenu(menu)
    }
  })

  observeCompactViewportChanges(syncMenuMode)
  window.addEventListener("resize", syncMenuMode)
  void document.fonts?.ready.then(syncMenuMode)
  syncMenuMode()
}

try {
  applyPageText()
  applyPageVersion()
  initTopMenus()
} catch (error) {
  showPlaceholderArt(CONFIG.runtime.controlModes.interactive, error)
}
