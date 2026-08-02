import { CONFIG, PAGE_COPYRIGHT_TEXT } from "./app/config"
import { showPlaceholderArt } from "./app/fallback-policy"

const { viewport } = CONFIG
const compactChromeClass = "page-chrome--compact"
const wideChromeClass = "page-chrome--wide"

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
  const topBar = document.querySelector<HTMLElement>(".top-bar")
  const compactWidthViewport = window.matchMedia(
    `(max-width: ${viewport.compactWidth}px)`,
  )
  const compactHeightViewport = window.matchMedia(
    `(max-height: ${viewport.compactHeight}px)`,
  )
  let compactMode = false

  // brandLines holds the title/subtitle/page-tag: individually short, but .top-bar__brand wraps
  // them onto their own line each once the row gets tight. That wrap never registers as scrollWidth
  // overflow — flexbox shrinks the brand box to fit and wraps its children inside it rather than
  // spilling out of .top-bar — so a squeezed, multi-line brand sits right next to the full-size wide
  // menu with nothing here to catch it.
  const brandLines = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".top-bar__title, .top-bar__subtitle, .top-bar__page-tag",
    ),
  )

  // brandWraps reports whether the brand's pieces have split across more than one line. Baseline
  // alignment jitters offsetTop by a couple of px even on one line, so the tolerance only has to
  // clear that; a real wrap is a full line-height apart, tens of px.
  function brandWraps(): boolean {
    if (brandLines.length === 0) {
      return false
    }

    const wrapTolerancePx = 6
    const firstTop = brandLines[0].offsetTop
    return brandLines.some(
      (line) => Math.abs(line.offsetTop - firstTop) > wrapTolerancePx,
    )
  }

  // wideMenuWouldOverflow checks the actual chrome width, so compacting also happens when the
  // viewport is wider than the phone breakpoint but the full title/menu row no longer fits — either
  // because it would scroll, or because the brand would wrap onto multiple squeezed lines instead.
  function wideMenuWouldOverflow(): boolean {
    if (!topBar || menus.length === 0) {
      return false
    }

    const root = document.documentElement
    const hadCompactClass = root.classList.contains(compactChromeClass)
    const hadWideClass = root.classList.contains(wideChromeClass)
    const openStates = menus.map((menu) => menu.open)

    root.classList.remove(compactChromeClass)
    root.classList.add(wideChromeClass)
    for (const menu of menus) {
      menu.open = true
    }

    const overflows = topBar.scrollWidth > topBar.clientWidth + 1 || brandWraps()

    root.classList.toggle(compactChromeClass, hadCompactClass)
    root.classList.toggle(wideChromeClass, hadWideClass)
    menus.forEach((menu, index) => {
      menu.open = openStates[index] ?? false
    })

    return overflows
  }

  // isCompactMode reports the latest synced state without remeasuring during click/key handlers.
  function isCompactMode(): boolean {
    return compactMode
  }

  // syncChromeMode exposes the shared compact/wide page state to CSS for every page.
  function syncChromeMode(): boolean {
    compactMode =
      compactWidthViewport.matches ||
      compactHeightViewport.matches ||
      wideMenuWouldOverflow()
    document.documentElement.classList.toggle(compactChromeClass, compactMode)
    document.documentElement.classList.toggle(wideChromeClass, !compactMode)

    return compactMode
  }

  if (menus.length === 0) {
    syncChromeMode()
    compactWidthViewport.addEventListener("change", syncChromeMode)
    compactHeightViewport.addEventListener("change", syncChromeMode)
    return
  }

  // closeMenu hides one details menu without duplicating attribute writes.
  function closeMenu(menu: HTMLDetailsElement): void {
    menu.open = false
  }

  // syncMenuMode expands menus on wide screens and collapses them on compact ones.
  function syncMenuMode(): void {
    const compact = syncChromeMode()
    for (const menu of menus) {
      menu.open = !compact
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
      if (isCompactMode() && menu.open) {
        closeOtherMenus(menu)
      }
    })
  }

  document.addEventListener("click", (event: MouseEvent) => {
    if (!isCompactMode()) {
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
    if (!isCompactMode()) {
      return
    }

    if (event.key !== "Escape") {
      return
    }

    for (const menu of menus) {
      closeMenu(menu)
    }
  })

  compactWidthViewport.addEventListener("change", syncMenuMode)
  compactHeightViewport.addEventListener("change", syncMenuMode)
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
