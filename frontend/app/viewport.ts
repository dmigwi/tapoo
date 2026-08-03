import { CONFIG } from "./config"

const { viewport } = CONFIG

export const compactChromeClass = "page-chrome--compact"
export const wideChromeClass = "page-chrome--wide"

// compactViewportMediaQueries returns the shared breakpoint queries used by page chrome and render.
export function compactViewportMediaQueries(): string[] {
  return [
    `(max-width: ${viewport.compactWidth}px)`,
    `(max-height: ${viewport.compactHeight}px)`,
  ]
}

// viewportSizeCandidates collects browser-level measurements for compact decisions.
export function viewportSizeCandidates(): {
  heightCandidates: number[]
  widthCandidates: number[]
} {
  const widthCandidates = [
    window.screen.width,
    window.screen.availWidth,
    window.visualViewport?.width ?? 0,
    document.documentElement.clientWidth,
    window.innerWidth,
  ].filter((value) => value > 0)
  const heightCandidates = [
    window.screen.height,
    window.screen.availHeight,
    window.visualViewport?.height ?? 0,
    document.documentElement.clientHeight,
    window.innerHeight,
  ].filter((value) => value > 0)

  return {
    widthCandidates,
    heightCandidates,
  }
}

// viewportWidth reports the narrowest live browser width used for layout-capacity decisions.
export function viewportWidth(): number {
  const { widthCandidates } = viewportSizeCandidates()

  return widthCandidates.length > 0 ? Math.min(...widthCandidates) : Number.POSITIVE_INFINITY
}

// fittingColumnCount reports how many fixed-width items can fit without changing their size.
export function fittingColumnCount({
  availableItemCount,
  gap,
  itemWidth,
  padding,
}: {
  availableItemCount: number
  gap: number
  itemWidth: number
  padding: number
}): number {
  const availableWidth = Math.max(0, viewportWidth() - padding * 2)
  const columnWidth = itemWidth + gap
  const fittingColumns = Math.floor((availableWidth + gap) / columnWidth)

  return Math.max(1, Math.min(availableItemCount, fittingColumns))
}

// cssPixelValue reads a CSS pixel custom property for UI layout helpers.
export function cssPixelValue(
  element: HTMLElement,
  propertyName: string,
): number {
  const value = Number.parseFloat(
    element.style.getPropertyValue(propertyName) ||
      getComputedStyle(element).getPropertyValue(propertyName) ||
      document.documentElement.style.getPropertyValue(propertyName) ||
      getComputedStyle(document.documentElement).getPropertyValue(propertyName),
  )

  return Number.isFinite(value) ? value : 0
}

// fittingTouchActionColumnCount reports how many visible touch action buttons fit on one row.
export function fittingTouchActionColumnCount(
  touchControls: HTMLElement,
  visibleButtons: number,
): number {
  return fittingColumnCount({
    availableItemCount: visibleButtons,
    gap: cssPixelValue(touchControls, "--touch-controls-gap"),
    itemWidth: cssPixelValue(touchControls, "--touch-action-button-min-width"),
    padding: cssPixelValue(touchControls, "--touch-controls-padding"),
  })
}

// isCompactViewport is the single compact-mode decision shared across the browser UI.
export function isCompactViewport(): boolean {
  const compactMedia = compactViewportMediaQueries().some(
    (query) => window.matchMedia(query).matches,
  )
  const { widthCandidates, heightCandidates } = viewportSizeCandidates()
  const compactWidth = widthCandidates.some((width) => width <= viewport.compactWidth)
  const compactHeight = heightCandidates.some((height) => height <= viewport.compactHeight)
  let compactChromePressure = false

  const topBar = document.querySelector<HTMLElement>(".top-bar")
  const menus = Array.from(document.querySelectorAll<HTMLDetailsElement>("details.top-menu"))
  if (topBar && menus.length > 0) {
    const root = document.documentElement
    const hadCompactClass = root.classList.contains(compactChromeClass)
    const hadWideClass = root.classList.contains(wideChromeClass)
    const openStates = menus.map((menu) => menu.open)

    root.classList.remove(compactChromeClass)
    root.classList.add(wideChromeClass)
    for (const menu of menus) {
      menu.open = true
    }

    try {
      const brandLines = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".top-bar__title, .top-bar__subtitle, .top-bar__page-tag",
        ),
      )
      const firstBrandTop = brandLines[0]?.offsetTop ?? 0
      const brandWrapTolerancePx = cssPixelValue(document.documentElement, "--brand-wrap-tolerance")
      const brandWraps = brandLines.some(
        (line) => Math.abs(line.offsetTop - firstBrandTop) > brandWrapTolerancePx,
      )

      compactChromePressure = topBar.scrollWidth > topBar.clientWidth + 1 || brandWraps
    } finally {
      root.classList.toggle(compactChromeClass, hadCompactClass)
      root.classList.toggle(wideChromeClass, hadWideClass)
      menus.forEach((menu, index) => {
        menu.open = openStates[index] ?? false
      })
    }
  }

  return compactMedia || compactWidth || compactHeight || compactChromePressure
}

// observeCompactViewportChanges wires all shared compact breakpoint transitions to one callback.
export function observeCompactViewportChanges(onChange: () => void): () => void {
  const queryLists = compactViewportMediaQueries().map((query) => window.matchMedia(query))

  for (const queryList of queryLists) {
    queryList.addEventListener("change", onChange)
  }

  return () => {
    for (const queryList of queryLists) {
      queryList.removeEventListener("change", onChange)
    }
  }
}
