import {
  CONFIG,
  PAGE_COPYRIGHT_TEXT,
  PAGE_UPDATED_AT,
  PAGE_UPDATED_TEMPLATE,
  PAGE_UPDATED_TITLE,
} from "./app/config"
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

// configDisplayText also permits finite numeric CONFIG values for visible informational copy.
function configDisplayText(key: string): string {
  const value = configValue(key)
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("en-US")
  }

  throw new Error(`missing display config entry: ${key}`)
}

// configInputValue permits string and finite numeric CONFIG values for form defaults. Numbers stay
// unlocalized so <input type="number"> receives a browser-parseable value.
function configInputValue(key: string): string {
  const value = configValue(key)
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  throw new Error(`missing input config entry: ${key}`)
}

// applyConfigAttribute copies CONFIG-backed text into matching DOM attributes.
function applyConfigAttribute(
  selector: string,
  attributeName: "content" | "textContent" | "aria-label" | "data-tooltip",
): void {
  const nodes = document.querySelectorAll<HTMLElement>(selector)

  for (const node of nodes) {
    const configKey = node.dataset.configKey
    if (!configKey) {
      continue
    }

    if (attributeName === "textContent") {
      node.textContent = configDisplayText(configKey)
      continue
    }

    const value = configText(configKey)
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

// RELATIVE_AGE_UNITS runs largest first. A unit is only used once its count reaches 2, so "1 min"
// and "1 mon" never appear — the age is spelled in the smaller unit instead ("90 secs", not
// "1 min"). That rule, not the unit list, is what sets the footer's worst case: a unit starting at
// 2 means the one below it must run to 119, making "119 secs" and "119 mins" the longest strings
// this can produce. The footer is sized for those, never for a short example like "11 mons".
//
// Months and years are the usual approximations (30 and 365 days). Nothing here needs calendar
// accuracy — the exact instant is in the title and the datetime attribute.
const RELATIVE_AGE_UNITS: ReadonlyArray<{ label: string; seconds: number }> = [
  { label: "yrs", seconds: 365 * 24 * 60 * 60 },
  { label: "mons", seconds: 30 * 24 * 60 * 60 },
  { label: "days", seconds: 24 * 60 * 60 },
  { label: "hrs", seconds: 60 * 60 },
  { label: "mins", seconds: 60 },
]

// relativeAge describes how long ago sinceMs was, in the compact units the footer has room for.
export function relativeAge(sinceMs: number, nowMs: number): string {
  // A clock behind the build's own timestamp would otherwise read as a negative age. Clamping to
  // zero is the honest answer: this build cannot be from the future.
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - sinceMs) / 1000))

  for (const { label, seconds } of RELATIVE_AGE_UNITS) {
    const count = Math.floor(elapsedSeconds / seconds)
    if (count >= 2) {
      return `${count} ${label}`
    }
  }

  return `${elapsedSeconds} ${elapsedSeconds === 1 ? "sec" : "secs"}`
}

// applyPageVersion keeps shared page chrome in sync with the configured copyright text.
export function applyPageVersion(): void {
  const updatedText = PAGE_UPDATED_TEMPLATE.replace(
    "{updated}",
    relativeAge(Date.parse(PAGE_UPDATED_AT), Date.now()),
  )

  const versionCopies = document.querySelectorAll<HTMLElement>("[data-page-version]")
  for (const element of versionCopies) {
    // Fresh nodes per element: a Node can only live at one place in the document.
    element.replaceChildren(footerPart(PAGE_COPYRIGHT_TEXT), " ", updatedTime(updatedText))
  }
}

// footerPart wraps one unbreakable run of footer copy. Rendering the footer as separate runs keeps
// any wrap between them rather than inside one — a single string breaks wherever it happens to fit.
function footerPart(text: string): HTMLSpanElement {
  const part = document.createElement("span")
  part.className = "page-footer__part"
  part.textContent = text
  return part
}

// updatedTime renders the age as a <time>, so the precise instant the visible text approximates
// stays available to crawlers, to assistive tech, and on hover — none of which costs footer width.
function updatedTime(text: string): HTMLTimeElement {
  const element = document.createElement("time")
  element.className = "page-footer__part"
  element.dateTime = PAGE_UPDATED_AT
  element.title = PAGE_UPDATED_TITLE
  element.setAttribute("aria-label", PAGE_UPDATED_TITLE)
  element.textContent = text
  return element
}

// applyPageText hydrates shared static copy such as labels and meta descriptions.
export function applyPageText(): void {
  applyDocumentTitle()
  applyConfigAttribute("[data-config-text]", "textContent")
  applyConfigAttribute("meta[data-config-key]", "content")
  // data-tooltip feeds the themed CSS-only tooltip (content: attr(data-tooltip)); aria-label
  // carries the same text to assistive tech, since the tooltip itself is decorative CSS content
  // a screen reader won't otherwise see.
  applyConfigAttribute("[data-config-title]", "data-tooltip")
  applyConfigAttribute("[data-config-title]", "aria-label")
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

      input.defaultValue = configInputValue(configKey)
      input.value = input.defaultValue
    })
}

// initTopMenus keeps shared top-bar menus expanded on wide screens and collapsible on compact ones.
export function initTopMenus(): void {
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
    if (!compactMode || event.key !== "Escape") {
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
