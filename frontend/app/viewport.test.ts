import { beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG } from "./config"
import {
  compactChromeClass,
  fittingColumnCount,
  fittingTouchActionColumnCount,
  isCompactViewport,
  observeCompactViewportChanges,
  wideChromeClass,
} from "./viewport"

const { viewport } = CONFIG
const wideTestViewport = 900

function mediaQueryList(matches = false): {
  addEventListener: ReturnType<typeof vi.fn>
  queryList: MediaQueryList
  removeEventListener: ReturnType<typeof vi.fn>
} {
  const addEventListener = vi.fn()
  const removeEventListener = vi.fn()
  const queryList = {
    matches,
    media: "",
    onchange: null,
    addEventListener,
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    removeEventListener,
    removeListener: vi.fn(),
  } as MediaQueryList

  return { addEventListener, queryList, removeEventListener }
}

describe("viewport helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    document.documentElement.className = ""
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: wideTestViewport,
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: wideTestViewport,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: wideTestViewport,
    })
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      value: wideTestViewport,
    })
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: wideTestViewport,
    })
    vi.restoreAllMocks()
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => mediaQueryList(false).queryList),
    )
  })

  it("treats the shared width or height breakpoint as compact", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) =>
        mediaQueryList(query === `(max-height: ${viewport.compactHeight}px)`).queryList,
      ),
    )

    expect(isCompactViewport()).toBe(true)
  })

  it("uses browser viewport room when media queries are still wide", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: viewport.compactWidth,
    })

    expect(isCompactViewport()).toBe(true)
  })

  it("calculates how many fixed-width layout columns fit in the viewport", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 320,
    })

    expect(
      fittingColumnCount({
        availableItemCount: 3,
        gap: 20,
        itemWidth: 132,
        padding: 14,
      }),
    ).toBe(2)
  })

  it("uses touch-control CSS variables when calculating action columns", () => {
    const touchControls = document.createElement("div")
    touchControls.style.setProperty("--touch-action-button-min-width", "100px")
    touchControls.style.setProperty("--touch-controls-gap", "10px")
    touchControls.style.setProperty("--touch-controls-padding", "12px")
    document.body.append(touchControls)
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 250,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 250,
    })

    expect(fittingTouchActionColumnCount(touchControls, 3)).toBe(2)
  })

  it("treats top menu overflow as compact viewport pressure", () => {
    document.body.innerHTML = `
      <header class="top-bar">
        <details class="top-menu"></details>
      </header>
    `
    const topBar = document.querySelector<HTMLElement>(".top-bar")
    const menu = document.querySelector<HTMLDetailsElement>("details.top-menu")
    if (!topBar || !menu) {
      throw new Error("test setup failed")
    }

    Object.defineProperty(topBar, "clientWidth", {
      configurable: true,
      value: 100,
    })
    Object.defineProperty(topBar, "scrollWidth", {
      configurable: true,
      value: 120,
    })
    document.documentElement.classList.add(compactChromeClass)

    expect(isCompactViewport()).toBe(true)
    expect(document.documentElement.classList.contains(compactChromeClass)).toBe(true)
    expect(document.documentElement.classList.contains(wideChromeClass)).toBe(false)
    expect(menu.open).toBe(false)
  })

  it("treats wrapped top-bar brand copy as compact viewport pressure", () => {
    document.body.innerHTML = `
      <header class="top-bar">
        <span class="top-bar__title"></span>
        <span class="top-bar__subtitle"></span>
        <details class="top-menu"></details>
      </header>
    `
    document.documentElement.style.setProperty("--brand-wrap-tolerance", "6px")
    const title = document.querySelector<HTMLElement>(".top-bar__title")
    const subtitle = document.querySelector<HTMLElement>(".top-bar__subtitle")
    if (!title || !subtitle) {
      throw new Error("test setup failed")
    }

    Object.defineProperty(title, "offsetTop", {
      configurable: true,
      value: 10,
    })
    Object.defineProperty(subtitle, "offsetTop", {
      configurable: true,
      value: 28,
    })

    expect(isCompactViewport()).toBe(true)
  })

  it("wires one listener to each compact breakpoint query", () => {
    const widthQuery = mediaQueryList()
    const heightQuery = mediaQueryList()
    vi.stubGlobal(
      "matchMedia",
      vi.fn()
        .mockReturnValueOnce(widthQuery.queryList)
        .mockReturnValueOnce(heightQuery.queryList),
    )

    const listener = vi.fn()
    const release = observeCompactViewportChanges(listener)

    expect(widthQuery.addEventListener).toHaveBeenCalledWith("change", listener)
    expect(heightQuery.addEventListener).toHaveBeenCalledWith("change", listener)

    release()

    expect(widthQuery.removeEventListener).toHaveBeenCalledWith("change", listener)
    expect(heightQuery.removeEventListener).toHaveBeenCalledWith("change", listener)
  })
})
